# Migrant Employees, Diaspora and Returnees

## Run locally

Install Python 3.10 or later. From the project root, create a virtual environment and install the backend dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

Create a file named `.env` in the project root (next to `README.md`). You can copy `.env.example` and replace the placeholders with your Atlas database credentials and Cloudinary product environment credentials. The backend also loads `backend\.env` as a fallback for missing environment variables. If the database password contains characters such as `@`, `:`, `/`, or `#`, URL-encode them first. The `.env` files are excluded from Git; never commit or share them.

```dotenv
MONGODB_URI=mongodb+srv://medar_org:<db_password>@cluster0.od3sa0a.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DATABASE=medar
MEDAR_ADMIN_EMAILS=group-admin@example.com
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@ohbljrgb
```

In Atlas, ensure your database user's password is correct and your current IP address is allowed in Network Access. Then start the FastAPI backend (it serves both the API and website on the same origin):

```powershell
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8080
```

Open `http://localhost:8080`. Do not open the HTML files directly from disk. The backend connects to the configured MongoDB database and stores uploaded document metadata there. New passport photos, identity documents, and supporting documents are stored as private Cloudinary assets; admins can view them from the Manage Members page through authenticated endpoints. Set `MONGODB_DATABASE` to select another database or `UPLOAD_DIR` to control access to legacy files already stored locally. Existing SQLite records are not automatically migrated to MongoDB.

The FastAPI backend provides the frontend's signup, login, account, and membership endpoints. It uses cookie-based sessions with CSRF tokens, hashes passwords, validates membership submissions, and stores account, session, and application records in MongoDB. Configure `CLOUDINARY_URL` with your Cloudinary product environment credentials in either `.env` file to accept member photos and documents, then restart the backend. Assets are uploaded privately; signed, time-limited URLs are used only by the authenticated server when generating a member's downloadable PDF ID or serving documents to admins. Keep this value secret and out of source control.

Set `MEDAR_ADMIN_EMAILS` to a comma-separated list of super-administrator account email addresses, then create accounts with those email addresses. Super administrators can manage membership applications and grant or revoke administrator access from the Manage Members page. Additional administrators must first have an account; regular administrators can manage members but cannot manage other administrators. Leave the setting empty to disable admin access. Members can apply as a beneficiary, partner, or founding member; an administrator can change this type from the Manage Members page.

## Production deployment

The included defaults are for local development, not public deployment. Before accepting real member data:

- Terminate HTTPS at the application or a trusted reverse proxy and set `COOKIE_SECURE=true`.
- Configure encrypted database and Cloudinary storage, restrictive filesystem permissions, protected backups, and a document-retention policy. MongoDB Atlas encrypts data at rest; any legacy local uploads also need appropriate storage protection.
- Configure and secure the Cloudinary product environment used for private member photos and documents, and include those assets in your retention and deletion policies.
- Keep `UPLOAD_DIR` outside the web root and prevent it from being exposed by any reverse proxy or static-file server.

The server stores uploaded Cloudinary documents privately and legacy uploads outside the public website directory, but does not scan files for malware. Configure secure file storage and a malware-scanning process before handling real member data.
