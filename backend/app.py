import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from urllib3.exceptions import HTTPError as Urllib3HTTPError

import cloudinary
from cloudinary import uploader as cloudinary_uploader
from cloudinary import utils as cloudinary_utils
from cloudinary.exceptions import Error as CloudinaryError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pymongo import ASCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv
from starlette.datastructures import UploadFile


ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")
cloudinary.reset_config()
cloudinary.config(secure=True)
FRONTEND_DIR = ROOT_DIR / "frontend"
UPLOAD_DIR = Path(
    os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "backend" / "private-uploads"))
).expanduser().resolve()
MONGODB_URI = os.environ.get("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "medar").strip()
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.environ.get("MEDAR_ADMIN_EMAILS", "").split(",")
    if email.strip()
}
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
SESSION_COOKIE = "medar_session"
SESSION_TTL_SECONDS = 14 * 24 * 60 * 60
PASSWORD_ITERATIONS = 600_000
MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
MAX_PASSPORT_PHOTO_SIZE = 5 * 1024 * 1024
MAX_APPLICATION_SIZE = 64 * 1024

app = FastAPI(title="MEDAR API")
logger = logging.getLogger(__name__)
mongo_client: MongoClient | None = None
mongo_database: Database | None = None


class SignupPayload(BaseModel):
    full_name: str = Field(alias="fullName", min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=6, max_length=72)


class LoginPayload(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=72)


class AdminEmailPayload(BaseModel):
    email: str = Field(min_length=3, max_length=254)


def get_database() -> Database:
    if mongo_database is None:
        raise RuntimeError("MongoDB has not been initialized.")
    return mongo_database


def initialize_database(database: Database) -> None:
    database.users.create_index([("email", ASCENDING)], unique=True)
    database.sessions.create_index([("token_hash", ASCENDING)], unique=True)
    database.sessions.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    database.applications.create_index([("user_id", ASCENDING)], unique=True)
    database.applications.create_index([("member_id", ASCENDING)], unique=True)


@app.on_event("startup")
def startup() -> None:
    global mongo_client, mongo_database
    if not FRONTEND_DIR.is_dir():
        raise RuntimeError(f"Frontend directory does not exist: {FRONTEND_DIR}")
    if not MONGODB_URI:
        raise RuntimeError("Set the MONGODB_URI environment variable to your MongoDB Atlas connection string.")
    if not MONGODB_DATABASE:
        raise RuntimeError("MONGODB_DATABASE cannot be empty.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    try:
        mongo_client.admin.command("ping")
    except Exception:
        mongo_client.close()
        mongo_client = None
        raise
    mongo_database = mongo_client[MONGODB_DATABASE]
    initialize_database(mongo_database)


@app.on_event("shutdown")
def shutdown() -> None:
    global mongo_client, mongo_database
    if mongo_client is not None:
        mongo_client.close()
    mongo_client = None
    mongo_database = None


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return normalized


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return "$".join(
        (
            "pbkdf2_sha256",
            str(PASSWORD_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        )
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, encoded_salt, encoded_digest = stored_hash.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt)
        expected = base64.urlsafe_b64decode(encoded_digest)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def find_session(database: Database, request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return database.sessions.find_one(
        {
            "token_hash": token_digest(token),
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        }
    )


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def create_session(
    database: Database, response: Response, user_id: Any | None
) -> str:
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc).timestamp() + SESSION_TTL_SECONDS
    database.sessions.insert_one(
        {
            "token_hash": token_digest(token),
            "user_id": user_id,
            "csrf_token": csrf_token,
            "expires_at": datetime.fromtimestamp(expires_at, timezone.utc),
        }
    )
    database.sessions.delete_many({"expires_at": {"$lte": datetime.now(timezone.utc)}})
    set_session_cookie(response, token)
    return csrf_token


def validate_csrf(
    database: Database, request: Request
) -> dict[str, Any]:
    session = find_session(database, request)
    submitted_token = request.headers.get("X-XSRF-TOKEN", "")
    if not session or not hmac.compare_digest(session["csrf_token"], submitted_token):
        raise HTTPException(status_code=403, detail="Your secure session expired. Refresh and try again.")
    return session


def require_user(
    request: Request, database: Database
) -> dict[str, Any]:
    session = find_session(database, request)
    if not session or session["user_id"] is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = database.users.find_one(
        {"_id": session["user_id"]},
        {"full_name": 1, "email": 1, "is_admin": 1},
    )
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def require_admin(request: Request, database: Database) -> dict[str, Any]:
    user = require_user(request, database)
    if user["email"] not in ADMIN_EMAILS and not user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Group administrator access required.")
    return user


def require_super_admin(request: Request, database: Database) -> dict[str, Any]:
    user = require_user(request, database)
    if user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Super administrator access required.")
    return user


@app.get("/api/auth/csrf")
def csrf_token(
    request: Request,
    response: Response,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = find_session(database, request)
    if session:
        return {"token": session["csrf_token"]}
    return {"token": create_session(database, response, None)}


@app.get("/api/auth/me")
def current_account(
    request: Request, database: Database = Depends(get_database)
) -> dict[str, Any]:
    user = require_user(request, database)
    return {
        "id": str(user["_id"]),
        "fullName": user["full_name"],
        "email": user["email"],
        "isAdmin": user["email"] in ADMIN_EMAILS or user.get("is_admin", False),
        "isSuperAdmin": user["email"] in ADMIN_EMAILS,
    }


@app.post("/api/auth/logout")
def logout(
    request: Request,
    response: Response,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    database.sessions.delete_one({"_id": session["_id"]})
    response.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, httponly=True, samesite="lax")
    return {"message": "Logged out successfully."}


@app.post("/api/auth/signup")
def signup(
    payload: SignupPayload,
    request: Request,
    response: Response,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    previous_session = validate_csrf(database, request)
    password_bytes = payload.password.encode("utf-8")
    if len(password_bytes) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 UTF-8 bytes.")
    email = normalize_email(payload.email)
    full_name = payload.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Enter your full name.")
    try:
        user = database.users.insert_one(
            {
                "full_name": full_name,
                "email": email,
                "password_hash": hash_password(payload.password),
                "created_at": datetime.now(timezone.utc),
            }
        )
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="An account with this email already exists.") from error
    database.sessions.delete_one({"token_hash": previous_session["token_hash"]})
    create_session(database, response, user.inserted_id)
    return {"fullName": full_name, "email": email}


@app.post("/api/auth/login")
def login(
    payload: LoginPayload,
    request: Request,
    response: Response,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    previous_session = validate_csrf(database, request)
    email = normalize_email(payload.email)
    user = database.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    database.sessions.delete_one({"token_hash": previous_session["token_hash"]})
    create_session(database, response, user["_id"])
    return {"fullName": user["full_name"], "email": user["email"]}


def required_text(payload: dict[str, Any], key: str, max_length: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
        raise HTTPException(status_code=422, detail=f"{key} is required and must be at most {max_length} characters.")
    return value.strip()


def optional_text(payload: dict[str, Any], key: str, max_length: int) -> str:
    value = payload.get(key, "")
    if value is None:
        return ""
    if not isinstance(value, str) or len(value.strip()) > max_length:
        raise HTTPException(status_code=422, detail=f"{key} must be at most {max_length} characters.")
    return value.strip()


def validate_application(raw_payload: str, user: dict[str, Any]) -> dict[str, Any]:
    try:
        payload_size = len(raw_payload.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise HTTPException(status_code=422, detail="Application details contain invalid text.") from error
    if payload_size > MAX_APPLICATION_SIZE:
        raise HTTPException(status_code=413, detail="Application details are too large.")
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="Application details must be valid JSON.") from error
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Application details must be an object.")

    normalized = {
        "fullName": required_text(payload, "fullName", 120),
        "dob": required_text(payload, "dob", 10),
        "gender": required_text(payload, "gender", 20),
        "nin": optional_text(payload, "nin", 100),
        "phone": required_text(payload, "phone", 40),
        "whatsapp": required_text(payload, "whatsapp", 40),
        "email": normalize_email(required_text(payload, "email", 254)),
        "country": required_text(payload, "country", 80),
        "city": optional_text(payload, "city", 120),
        "status": required_text(payload, "status", 80),
        "membershipType": payload.get("membershipType", "member"),
        "agency": optional_text(payload, "agency", 160),
        "additionalInformation": optional_text(payload, "additionalInformation", 5000),
        "emergencyName": optional_text(payload, "emergencyName", 120),
        "emergencyPhone": optional_text(payload, "emergencyPhone", 40),
    }

    try:
        date.fromisoformat(normalized["dob"])
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Enter a valid date of birth.") from error
    if normalized["gender"] not in {"Male", "Female"}:
        raise HTTPException(status_code=422, detail="Choose a valid gender.")
    if normalized["country"] not in {
        "Saudi Arabia", "UAE - Dubai", "Qatar", "Kuwait", "Oman",
        "USA", "UK", "Uganda", "Other",
    }:
        raise HTTPException(status_code=422, detail="Choose a valid country.")
    if normalized["status"] not in {
        "Migrant Employee Abroad", "Diaspora", "Returnee", "Family Member of Migrant",
    }:
        raise HTTPException(status_code=422, detail="Choose a valid membership status.")
    if (
        not isinstance(normalized["membershipType"], str)
        or normalized["membershipType"] not in {"member", "donor", "investor"}
    ):
        raise HTTPException(status_code=422, detail="Choose a valid membership type.")
    if normalized["email"] != user["email"]:
        raise HTTPException(status_code=422, detail="Application email must match your account.")
    if normalized["fullName"] != user["full_name"]:
        raise HTTPException(status_code=422, detail="Application name must match your account.")

    services = payload.get("servicesNeeded", [])
    allowed_services = {
        "Airport Picking", "Hotel & Travel Docs", "Legal Support",
        "Land & Construction", "Job Connections", "Rental Management",
        "Employment Guidance", "Counseling", "Savings & Member Credit",
    }
    if (
        not isinstance(services, list)
        or len(services) > len(allowed_services)
        or any(not isinstance(service, str) or service not in allowed_services for service in services)
    ):
        raise HTTPException(status_code=422, detail="Choose valid membership services.")
    normalized["servicesNeeded"] = services
    return normalized


def read_upload(upload: UploadFile, allowed_extensions: set[str]) -> tuple[bytes, str]:
    filename = upload.filename or ""
    extension = Path(filename.replace("\\", "/")).suffix.lower()
    if extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported document type.")
    content = upload.file.read(MAX_DOCUMENT_SIZE + 1)
    if len(content) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=413, detail="Each document must be 10 MB or smaller.")
    if extension == ".pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")
    if extension in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid JPEG.")
    if extension == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PNG.")
    return content, extension


def normalize_passport_photo(content: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG"}:
                raise HTTPException(status_code=400, detail="Upload a JPG or PNG passport photo.")
            if image.width * image.height > 20_000_000:
                raise HTTPException(status_code=400, detail="The passport photo dimensions are too large.")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((640, 800))
            normalized = io.BytesIO()
            image.save(normalized, format="JPEG", quality=88, optimize=True)
            return normalized.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=400, detail="The uploaded passport photo is not a valid image.") from error


def require_cloudinary() -> None:
    config = cloudinary.config()
    if not config.cloud_name or not config.api_key or not config.api_secret:
        raise HTTPException(
            status_code=503,
            detail="Passport photo storage is not configured. Set CLOUDINARY_URL in the project-root .env or backend/.env, then restart the server.",
        )


def upload_private_passport_photo(content: bytes) -> str:
    require_cloudinary()
    public_id = f"medar/member-photos/{uuid.uuid4().hex}"
    try:
        result = cloudinary_uploader.upload(
            io.BytesIO(content),
            public_id=public_id,
            resource_type="image",
            type="private",
            overwrite=False,
            unique_filename=False,
        )
    except (CloudinaryError, Urllib3HTTPError, TimeoutError, OSError) as error:
        logger.exception("Cloudinary passport photo upload failed.")
        raise HTTPException(
            status_code=502,
            detail="Unable to store your passport photo. Please try again.",
        ) from error
    uploaded_public_id = result.get("public_id") if isinstance(result, dict) else None
    if not isinstance(uploaded_public_id, str) or not uploaded_public_id:
        raise HTTPException(
            status_code=502,
            detail="Cloudinary did not confirm the passport photo upload.",
        )
    return uploaded_public_id


def delete_private_passport_photo(public_id: str) -> None:
    require_cloudinary()
    try:
        result = cloudinary_uploader.destroy(
            public_id,
            resource_type="image",
            type="private",
            invalidate=True,
        )
    except (CloudinaryError, Urllib3HTTPError, TimeoutError, OSError) as error:
        logger.exception("Cloudinary passport photo deletion failed.")
        raise HTTPException(
            status_code=502,
            detail="Unable to remove the member's private passport photo.",
        ) from error
    if not isinstance(result, dict) or result.get("result") not in {"ok", "not found"}:
        raise HTTPException(status_code=502, detail="Cloudinary did not confirm the photo deletion.")


def create_member_id_pdf(
    payload: dict[str, Any],
    member_id: str,
    photo_bytes: bytes,
    submitted_at: datetime,
) -> bytes:
    page_width, page_height = 85.6 * mm, 54 * mm
    output = io.BytesIO()
    document = canvas.Canvas(output, pagesize=(page_width, page_height), pageCompression=1)
    document.setTitle(f"MEDAR Member ID {member_id}")
    document.setFillColor(white)
    document.roundRect(1 * mm, 1 * mm, page_width - 2 * mm, page_height - 2 * mm, 3 * mm, fill=1, stroke=0)
    document.setFillColor(HexColor("#32105f"))
    document.roundRect(1 * mm, page_height - 15 * mm, page_width - 2 * mm, 14 * mm, 3 * mm, fill=1, stroke=0)
    document.rect(1 * mm, page_height - 15 * mm, page_width - 2 * mm, 3 * mm, fill=1, stroke=0)
    document.setFillColor(white)
    document.setFont("Helvetica-Bold", 8)
    document.drawString(5 * mm, page_height - 7 * mm, "MIGRANT EMPLOYEES,")
    document.setFont("Helvetica", 6)
    document.drawString(5 * mm, page_height - 11 * mm, "DIASPORA AND RETURNEES")
    document.setFont("Helvetica-Bold", 7)
    document.drawRightString(page_width - 5 * mm, page_height - 9 * mm, "MEMBERSHIP ID")

    photo_x, photo_y, photo_width, photo_height = 5 * mm, 8 * mm, 23 * mm, 29 * mm
    document.setStrokeColor(HexColor("#ddd6e8"))
    document.roundRect(photo_x, photo_y, photo_width, photo_height, 1.5 * mm, fill=0, stroke=1)
    document.saveState()
    photo_clip = document.beginPath()
    photo_clip.roundRect(photo_x, photo_y, photo_width, photo_height, 1.5 * mm)
    document.clipPath(photo_clip, stroke=0)
    document.drawImage(
        ImageReader(io.BytesIO(photo_bytes)),
        photo_x,
        photo_y,
        width=photo_width,
        height=photo_height,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    document.restoreState()

    details_x = 32 * mm
    document.setFillColor(HexColor("#777184"))
    document.setFont("Helvetica-Bold", 5)
    document.drawString(details_x, 34 * mm, "MEMBER NAME")
    member_name = str(payload.get("fullName", ""))
    font_size = 9
    while font_size > 6 and document.stringWidth(member_name, "Helvetica-Bold", font_size) > 48 * mm:
        font_size -= 0.5
    document.setFillColor(HexColor("#32105f"))
    document.setFont("Helvetica-Bold", font_size)
    document.drawString(details_x, 29 * mm, member_name)
    document.setFillColor(HexColor("#777184"))
    document.setFont("Helvetica-Bold", 5)
    document.drawString(details_x, 22 * mm, "MEMBER ID")
    document.drawString(details_x, 13 * mm, "COUNTRY")
    document.drawString(58 * mm, 13 * mm, "MEMBERSHIP TYPE")
    document.setFillColor(HexColor("#302b3a"))
    document.setFont("Helvetica-Bold", 7)
    document.drawString(details_x, 18 * mm, member_id)
    document.setFont("Helvetica", 6)
    document.drawString(details_x, 9 * mm, str(payload.get("country", ""))[:24])
    membership_type = str(payload.get("membershipType", "member")).capitalize()
    document.drawString(58 * mm, 9 * mm, membership_type)
    issue_date = submitted_at.date().isoformat()
    document.setFillColor(HexColor("#0B8A42"))
    document.setFont("Helvetica-Bold", 5)
    document.drawRightString(page_width - 5 * mm, 3 * mm, f"ISSUED {issue_date}")
    document.showPage()
    document.save()
    return output.getvalue()


@app.get("/api/members/me")
def current_application(
    request: Request, database: Database = Depends(get_database)
) -> dict[str, Any]:
    user = require_user(request, database)
    application = database.applications.find_one(
        {"user_id": user["_id"]},
        {
            "member_id": 1,
            "payload.fullName": 1,
            "payload.country": 1,
            "payload.membershipType": 1,
            "passport_photo.public_id": 1,
        },
    )
    if not application:
        return {"submitted": False}
    payload = application.get("payload", {})
    passport_photo = application.get("passport_photo")
    return {
        "submitted": True,
        "memberId": application["member_id"],
        "hasPhoto": bool(
            isinstance(passport_photo, dict) and passport_photo.get("public_id")
        ),
        "fullName": payload.get("fullName", ""),
        "country": payload.get("country", ""),
        "membershipType": payload.get("membershipType", "member"),
    }


@app.get("/api/members/me/id-card.pdf")
def download_member_id(
    request: Request, database: Database = Depends(get_database)
) -> StreamingResponse:
    user = require_user(request, database)
    application = database.applications.find_one({"user_id": user["_id"]})
    if not application:
        raise HTTPException(status_code=404, detail="Submit a membership application before downloading your ID.")
    photo = application.get("passport_photo", {})
    public_id = photo.get("public_id") if isinstance(photo, dict) else None
    if not isinstance(public_id, str) or not public_id:
        raise HTTPException(status_code=409, detail="Upload a passport photo before downloading your Member ID.")
    require_cloudinary()
    try:
        photo_url = cloudinary_utils.private_download_url(
            public_id,
            "jpg",
            resource_type="image",
            type="private",
            attachment=False,
            expires_at=int(time.time()) + 300,
        )
        with urlopen(photo_url, timeout=15) as photo_response:
            photo_bytes = photo_response.read(MAX_PASSPORT_PHOTO_SIZE + 1)
        if len(photo_bytes) > MAX_PASSPORT_PHOTO_SIZE:
            raise HTTPException(status_code=502, detail="The stored passport photo is larger than expected.")
    except (CloudinaryError, HTTPError, URLError, TimeoutError, OSError, Urllib3HTTPError) as error:
        logger.exception("Unable to retrieve a private Cloudinary passport photo for ID generation.")
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve your passport photo to generate the Member ID.",
        ) from error
    pdf_bytes = create_member_id_pdf(
        application.get("payload", {}),
        application["member_id"],
        photo_bytes,
        application["submitted_at"],
    )
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{application["member_id"]}.pdf"',
            "Cache-Control": "private, no-store",
        },
    )


@app.post("/api/members/photo")
async def upload_member_id_photo(
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    user = require_user(request, database)
    if session["user_id"] != user["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")
    application = database.applications.find_one(
        {"user_id": user["_id"]},
        {"_id": 1, "member_id": 1, "passport_photo.public_id": 1},
    )
    if not application:
        raise HTTPException(status_code=404, detail="Submit a membership application before uploading an ID photo.")
    saved_photo = application.get("passport_photo")
    if isinstance(saved_photo, dict) and saved_photo.get("public_id"):
        raise HTTPException(status_code=409, detail="A passport photo is already saved for this Member ID.")
    form = await request.form()
    photo_parts = form.getlist("passportPhoto")
    photo_uploads = [
        part for part in photo_parts if isinstance(part, UploadFile) and part.filename
    ]
    if len(photo_uploads) != 1:
        raise HTTPException(status_code=400, detail="Choose one passport photo to upload.")
    content, _ = read_upload(photo_uploads[0], {".jpg", ".jpeg", ".png"})
    if len(content) > MAX_PASSPORT_PHOTO_SIZE:
        raise HTTPException(status_code=413, detail="The passport photo must be 5 MB or smaller.")
    photo_bytes = normalize_passport_photo(content)
    public_id = upload_private_passport_photo(photo_bytes)
    update = database.applications.update_one(
        {"_id": application["_id"], "passport_photo.public_id": {"$exists": False}},
        {"$set": {"passport_photo": {"public_id": public_id, "format": "jpg"}}},
    )
    if update.matched_count == 0:
        delete_private_passport_photo(public_id)
        raise HTTPException(status_code=409, detail="A passport photo is already saved for this Member ID.")
    return {
        "message": "Passport photo uploaded successfully.",
        "memberId": application["member_id"],
    }


@app.get("/api/admin/members")
def list_members_for_admin(
    request: Request, database: Database = Depends(get_database)
) -> dict[str, list[dict[str, Any]]]:
    require_admin(request, database)
    applications = list(
        database.applications.find(
            {},
            {
                "user_id": 1,
                "member_id": 1,
                "payload.fullName": 1,
                "payload.country": 1,
                "payload.status": 1,
                "payload.membershipType": 1,
                "submitted_at": 1,
            },
        ).sort("submitted_at", -1)
    )
    users = {
        user["_id"]: user
        for user in database.users.find(
            {"_id": {"$in": [application["user_id"] for application in applications]}},
            {"full_name": 1, "email": 1},
        )
    }
    return {
        "members": [
            {
                "memberId": application["member_id"],
                "fullName": users.get(application["user_id"], {}).get(
                    "full_name", application.get("payload", {}).get("fullName", "")
                ),
                "email": users.get(application["user_id"], {}).get("email", ""),
                "country": application.get("payload", {}).get("country", ""),
                "memberStatus": application.get("payload", {}).get("status", ""),
                "membershipType": application.get("payload", {}).get(
                    "membershipType", "member"
                ),
                "submittedAt": application.get("submitted_at"),
            }
            for application in applications
        ]
    }


@app.get("/api/admin/admins")
def list_admins(
    request: Request, database: Database = Depends(get_database)
) -> dict[str, list[dict[str, str]]]:
    require_super_admin(request, database)
    configured_admins = [
        {"email": email, "fullName": "Super administrator", "role": "super"}
        for email in sorted(ADMIN_EMAILS)
    ]
    managed_admins = [
        {"email": user["email"], "fullName": user.get("full_name", ""), "role": "admin"}
        for user in database.users.find(
            {"is_admin": True, "email": {"$nin": list(ADMIN_EMAILS)}},
            {"email": 1, "full_name": 1},
        ).sort("email", 1)
    ]
    return {"admins": configured_admins + managed_admins}


@app.post("/api/admin/admins")
def grant_admin_access(
    payload: AdminEmailPayload,
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    super_admin = require_super_admin(request, database)
    if session["user_id"] != super_admin["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")
    email = normalize_email(payload.email)
    if email in ADMIN_EMAILS:
        raise HTTPException(status_code=409, detail="This account is already a super administrator.")
    user = database.users.find_one({"email": email}, {"_id": 1, "is_admin": 1})
    if not user:
        raise HTTPException(
            status_code=404,
            detail="No account uses this email yet. Ask them to create an account first.",
        )
    if user.get("is_admin", False):
        raise HTTPException(status_code=409, detail="This account is already an administrator.")
    database.users.update_one({"_id": user["_id"]}, {"$set": {"is_admin": True}})
    return {"message": "Administrator access granted."}


@app.delete("/api/admin/admins/{email}")
def revoke_admin_access(
    email: str,
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    super_admin = require_super_admin(request, database)
    if session["user_id"] != super_admin["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")
    normalized_email = normalize_email(email)
    if normalized_email in ADMIN_EMAILS:
        raise HTTPException(
            status_code=403,
            detail="Super administrator access is managed through the deployment environment.",
        )
    result = database.users.update_one(
        {"email": normalized_email, "is_admin": True},
        {"$unset": {"is_admin": ""}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Managed administrator not found.")
    return {"message": "Administrator access revoked."}


@app.patch("/api/admin/members/{member_id}")
def update_member_type(
    member_id: str,
    payload: dict[str, Any],
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    admin = require_admin(request, database)
    if session["user_id"] != admin["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")
    membership_type = payload.get("membershipType")
    if (
        not isinstance(membership_type, str)
        or membership_type not in {"member", "donor", "investor"}
    ):
        raise HTTPException(status_code=422, detail="Choose a valid membership type.")
    result = database.applications.update_one(
        {"member_id": member_id},
        {"$set": {"payload.membershipType": membership_type}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member not found.")
    return {"message": "Member type updated successfully."}


@app.delete("/api/admin/members/{member_id}")
def delete_member(
    member_id: str,
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    admin = require_admin(request, database)
    if session["user_id"] != admin["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")
    application = database.applications.find_one(
        {"member_id": member_id},
        {"documents.storageName": 1, "passport_photo.public_id": 1},
    )
    if not application:
        raise HTTPException(status_code=404, detail="Member not found.")
    stored_files = []
    for document in application.get("documents", []):
        storage_name = document.get("storageName")
        if not isinstance(storage_name, str) or Path(storage_name).name != storage_name:
            raise RuntimeError("Stored membership document has an invalid filename.")
        stored_file = (UPLOAD_DIR / storage_name).resolve()
        if stored_file.parent != UPLOAD_DIR:
            raise RuntimeError("Stored membership document is outside the upload directory.")
        stored_files.append(stored_file)
    passport_photo = application.get("passport_photo", {})
    public_id = passport_photo.get("public_id") if isinstance(passport_photo, dict) else None
    if isinstance(public_id, str) and public_id:
        delete_private_passport_photo(public_id)
    database.applications.delete_one({"_id": application["_id"]})
    for stored_file in stored_files:
        stored_file.unlink(missing_ok=True)
    return {"message": "Membership application deleted successfully."}


@app.post("/api/members")
async def submit_application(
    request: Request,
    database: Database = Depends(get_database),
) -> dict[str, str]:
    session = validate_csrf(database, request)
    user = require_user(request, database)
    if session["user_id"] != user["_id"]:
        raise HTTPException(status_code=401, detail="Authentication required.")

    form = await request.form()
    application_part = form.get("application")
    if isinstance(application_part, UploadFile):
        application_bytes = await application_part.read(MAX_APPLICATION_SIZE + 1)
        if len(application_bytes) > MAX_APPLICATION_SIZE:
            raise HTTPException(status_code=413, detail="Application details are too large.")
        try:
            raw_application = application_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise HTTPException(status_code=422, detail="Application details must be UTF-8 JSON.") from error
    elif isinstance(application_part, str):
        raw_application = application_part
    else:
        raise HTTPException(status_code=422, detail="Application details are required.")
    payload = validate_application(raw_application, user)

    identity_parts = form.getlist("identityDocument")
    identity_uploads = [part for part in identity_parts if isinstance(part, UploadFile) and part.filename]
    if len(identity_uploads) > 1:
        raise HTTPException(status_code=400, detail="Upload only one identity document.")
    supporting_uploads = [
        part
        for part in form.getlist("supportingDocuments")
        if isinstance(part, UploadFile) and part.filename
    ]
    if len(supporting_uploads) > 5:
        raise HTTPException(status_code=400, detail="Choose no more than 5 supporting documents.")
    photo_parts = form.getlist("passportPhoto")
    photo_uploads = [
        part for part in photo_parts if isinstance(part, UploadFile) and part.filename
    ]
    if len(photo_uploads) != 1:
        raise HTTPException(status_code=400, detail="Upload one passport-style photo for your Member ID.")
    photo_content, _ = read_upload(photo_uploads[0], {".jpg", ".jpeg", ".png"})
    if len(photo_content) > MAX_PASSPORT_PHOTO_SIZE:
        raise HTTPException(status_code=413, detail="The passport photo must be 5 MB or smaller.")
    photo_bytes = normalize_passport_photo(photo_content)

    upload_items: list[tuple[UploadFile, set[str], str]] = []
    if identity_uploads:
        upload_items.append((identity_uploads[0], {".pdf"}, "identity"))
    upload_items.extend(
        (upload, {".pdf", ".jpg", ".jpeg", ".png"}, "supporting")
        for upload in supporting_uploads
    )

    if database.applications.find_one({"user_id": user["_id"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A membership application has already been submitted.")

    created_files: list[Path] = []
    passport_photo_public_id: str | None = None
    committed = False
    try:
        stored_documents = []
        for upload, allowed_extensions, category in upload_items:
            content, extension = read_upload(upload, allowed_extensions)
            storage_name = f"{uuid.uuid4().hex}{extension}"
            destination = UPLOAD_DIR / storage_name
            with destination.open("xb") as document_file:
                created_files.append(destination)
                document_file.write(content)
            original_name = Path((upload.filename or "").replace("\\", "/")).name[:255]
            stored_documents.append(
                {"category": category, "filename": original_name, "storageName": storage_name}
            )

        passport_photo_public_id = upload_private_passport_photo(photo_bytes)
        member_id = f"MEDAR-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        database.applications.insert_one(
            {
                "user_id": user["_id"],
                "member_id": member_id,
                "payload": payload,
                "documents": stored_documents,
                "passport_photo": {
                    "public_id": passport_photo_public_id,
                    "format": "jpg",
                },
                "submitted_at": datetime.now(timezone.utc),
            }
        )
        committed = True
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="A membership application has already been submitted.") from error
    finally:
        if not committed:
            for created_file in created_files:
                created_file.unlink(missing_ok=True)
            if passport_photo_public_id:
                delete_private_passport_photo(passport_photo_public_id)

    return {"memberId": member_id}


if not FRONTEND_DIR.is_dir():
    raise RuntimeError(f"Frontend directory does not exist: {FRONTEND_DIR}")


@app.get("/admin-members.html")
def admin_members_page(
    request: Request, database: Database = Depends(get_database)
) -> Response:
    try:
        require_admin(request, database)
    except HTTPException as error:
        if error.status_code == 401:
            return RedirectResponse(
                "/login.html?next=%2Fadmin-members.html", status_code=303
            )
        if error.status_code == 403:
            return RedirectResponse("/index.html", status_code=303)
        raise
    return FileResponse(FRONTEND_DIR / "admin-members.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
