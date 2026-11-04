# Migrant Employees, Diaspora and Returnees

## Run locally

Install Python 3.10 or later. From the project root, create a virtual environment and install the backend dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

Create a file named `.env` in the project root (next to `README.md`). You can copy `.env.example` and replace the placeholder with your Atlas database user's password. If the password contains characters such as `@`, `:`, `/`, or `#`, URL-encode them first. The `.env` file is excluded from Git; never commit or share it.

```dotenv
MONGODB_URI=mongodb+srv://medar_org:<db_password>@cluster0.od3sa0a.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DATABASE=medar
MEDAR_ADMIN_EMAILS=group-admin@example.com
```

In Atlas, ensure your database user's password is correct and your current IP address is allowed in Network Access. Then start the FastAPI backend (it serves both the API and website on the same origin):

```powershell
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8080
```

Open `http://localhost:8080`. Do not open the HTML files directly from disk. The backend connects to the configured MongoDB database and stores uploaded document metadata there; the files themselves remain under `backend\private-uploads`, outside the public frontend directory. Set `MONGODB_DATABASE` to select another database or `UPLOAD_DIR` to change the document storage location. Existing SQLite records are not automatically migrated to MongoDB.

The FastAPI backend provides the frontend's signup, login, account, and membership endpoints. It uses cookie-based sessions with CSRF tokens, hashes passwords, validates membership submissions, and stores account, session, and application records in MongoDB.

Set `MEDAR_ADMIN_EMAILS` to a comma-separated list of account email addresses that should manage membership applications, then create accounts with those email addresses. Only those signed-in accounts can list, update, or delete member applications. Leave the setting empty to disable admin access. Members can apply as a member, donor, or investor; an administrator can change this type from the Manage Members page.

## Production deployment

The included defaults are for local development, not public deployment. Before accepting real member data:

- Terminate HTTPS at the application or a trusted reverse proxy and set `COOKIE_SECURE=true`.
- Configure encrypted database and upload storage, restrictive filesystem permissions, protected backups, and a document-retention policy. MongoDB Atlas encrypts data at rest, but the local uploaded files still need appropriate storage protection.
- Keep `UPLOAD_DIR` outside the web root and prevent it from being exposed by any reverse proxy or static-file server.

The server stores uploaded documents outside the public website directory, but does not scan them for malware. Configure secure file storage and a malware-scanning process before handling real member data.
