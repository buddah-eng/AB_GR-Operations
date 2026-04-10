# Infrastructure Setup

> Provision three things: a PostgreSQL 16+ database, a Node.js backend host, and a static file host for the SPA.
> Platform-agnostic by default. Vercel, GCP, AWS, Railway, Fly.io, or a VPS with Docker all work.
> Total infrastructure cost ranges from $0 (free tiers) to ~$50-80/month at production scale.

---

## 1. Clone the Repository

```bash
git clone https://github.com/buddah-eng/AB_GR-Operations.git
cd AB_GR-Operations
```

---

## 2. Database Provisioning

GR-Ops requires PostgreSQL 16 or later. Any Postgres provider works.

### Option A: Local Docker (Development)

```bash
docker run -d \
  --name gr-ops-db \
  -p 5432:5432 \
  -e POSTGRES_DB=gr_ops \
  -e POSTGRES_USER=gr_ops \
  -e POSTGRES_PASSWORD=dev \
  postgres:16-alpine
```

Verify the container is running:

```bash
docker exec gr-ops-db psql -U gr_ops -d gr_ops -c "SELECT version();"
```

### Option B: Managed Cloud Postgres

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| [Neon](https://neon.tech) | 0.5 GB storage, 190 compute hours/month | Serverless Postgres, scales to zero |
| [Supabase](https://supabase.com) | 500 MB storage | Includes auth, but GR-Ops uses its own |
| [Railway](https://railway.app) | $5/month credit | Simple provisioning |
| [AWS RDS](https://aws.amazon.com/rds/) | 12 months free (db.t3.micro) | More setup required |
| [Google Cloud SQL](https://cloud.google.com/sql) | $8/month (db-f1-micro) | Regional, managed backups |

**Vercel note:** Neon Postgres is available directly from the [Vercel Marketplace](https://vercel.com/marketplace). Navigate to your Vercel project settings, go to the Integrations tab, search for "Neon," and provision a database. Vercel automatically injects the `DATABASE_URL` environment variable into your deployment -- no manual configuration needed. The free tier (Hobby plan) is sufficient for development and small conventions.

After provisioning, note down these values for your environment variables:

- `DB_HOST` -- the database hostname (e.g., `ep-cool-paper-123456.us-east-2.aws.neon.tech`)
- `DB_PORT` -- usually `5432`
- `DB_NAME` -- the database name (e.g., `gr_ops`)
- `DB_USER` -- the database user
- `DB_PASSWORD` -- the database password

---

## 3. Backend Deployment

The backend is a Node.js 20 + Express application located in `functions/`. It can be deployed anywhere that runs Node.js.

### Build the Backend

```bash
cd functions
npm install
npm run build
```

This compiles TypeScript to JavaScript in `functions/lib/`.

### Option A: Docker Container

Create a `Dockerfile` in the project root (or use the existing one if present):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY functions/package*.json ./
RUN npm ci --production
COPY functions/lib/ ./lib/
EXPOSE 8080
ENV PORT=8080
CMD ["node", "lib/index.js"]
```

Deploy to any container platform:
- **Google Cloud Run:** `gcloud run deploy gr-ops-api --source .`
- **Fly.io:** `fly launch` then `fly deploy`
- **Railway:** Connect your GitHub repo, set the root directory to `functions/`
- **Any VPS:** Build the image and run with `docker run -p 8080:8080`

### Option B: Firebase Functions

The project includes `firebase.json` for Firebase deployment:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only functions
```

### Option C: Vercel Functions

**Vercel note:** Vercel can run the Express backend as a Vercel Function. Create a `vercel.json` in the project root:

```json
{
  "functions": {
    "functions/lib/index.js": {
      "runtime": "nodejs20.x",
      "memory": 512,
      "maxDuration": 30
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/functions/lib/index.js" }
  ]
}
```

For Fluid Compute (connection pooling across invocations), enable it in the Vercel dashboard under Project Settings > Functions. This is recommended for Postgres connections.

---

## 4. Frontend Deployment

The frontend is a Vue 3 SPA located in `web/`. After building, it produces static files that can be hosted anywhere.

### Build the Frontend

```bash
cd web
npm install
npm run build
```

This produces static files in `web/dist/`.

### Hosting Options

| Platform | Command | Notes |
|----------|---------|-------|
| Any static host | Upload `web/dist/` | Netlify, Cloudflare Pages, S3 + CloudFront |
| Firebase Hosting | `firebase deploy --only hosting` | Uses `firebase.json` config |
| Vercel | `vercel deploy` | Auto-detects Vite framework |
| Docker + Nginx | Serve `web/dist/` from Nginx container | Self-hosted option |

**Vercel note:** Vercel auto-detects the Vite framework in `web/` and builds accordingly. Set the root directory to `web/` in the Vercel project settings, or use a monorepo configuration that builds both `functions/` and `web/`.

---

## 5. Environment Variables

### Backend (`functions/`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DB_HOST` | PostgreSQL hostname | Yes | -- |
| `DB_PORT` | PostgreSQL port | No | `5432` |
| `DB_NAME` | PostgreSQL database name | Yes | -- |
| `DB_USER` | PostgreSQL user | Yes | -- |
| `DB_PASSWORD` | PostgreSQL password | Yes | -- |
| `ENCRYPTION_KEY` | 64-char hex string for PII field encryption | Production | -- |
| `HMAC_KEY` | 64-char hex string for blind index (encrypted search) | Production | -- |
| `PORT` | HTTP listen port | No | `8080` |
| `NODE_ENV` | `development` or `production` | No | `development` |

Generate encryption keys:

```bash
# ENCRYPTION_KEY (64 hex characters = 32 bytes)
openssl rand -hex 32

# HMAC_KEY (64 hex characters = 32 bytes)
openssl rand -hex 32
```

### Frontend (`web/`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API URL (e.g., `https://api.yourcon.org`) | -- (required) |
| `VITE_DEMO_MODE` | Enable demo mode (`true`/`false`) | `false` |
| `VITE_DEV_BYPASS_AUTH` | Bypass Firebase auth in development | `false` |
| `CONVENTION_NAME` | Convention name shown in the UI | `Convention` |
| `VITE_PRIMARY_50` ... `VITE_PRIMARY_950` | Primary color scale overrides | Slate blue |
| `VITE_ACCENT_50` ... `VITE_ACCENT_900` | Accent color scale overrides | Warm amber |

Create `.env.local` files for local development:

```bash
# functions/.env.local
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gr_ops
DB_USER=gr_ops
DB_PASSWORD=dev

# web/.env.local
VITE_API_BASE_URL=http://localhost:8080
VITE_DEV_BYPASS_AUTH=true
```

**Vercel note:** Set environment variables in the Vercel dashboard under Project Settings > Environment Variables. When using Neon Postgres from the Vercel Marketplace, database credentials are auto-injected. The variable format may differ (`DATABASE_URL` vs individual vars) -- check your connection string and map accordingly.

---

## 6. Domain Setup (Optional)

If you have a custom domain:

1. Point your domain's DNS to your hosting provider.
2. Configure the backend on a subdomain (e.g., `api.yourcon.org`) or a path prefix (e.g., `yourcon.org/api`).
3. Update `VITE_API_BASE_URL` in the frontend to match.
4. Enable HTTPS (most hosting platforms do this automatically).

---

## 7. Firebase Authentication (Optional)

GR-Ops uses Firebase Authentication for user identity. If you want to use Firebase Auth:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable Google OAuth (or email/password) as a sign-in provider.
3. Copy the Firebase config to `web/src/firebase.ts`.
4. Set up the Firebase Admin SDK credentials for the backend.

If you do not want to use Firebase Auth, you can use the dev bypass mode (`VITE_DEV_BYPASS_AUTH=true`) for development, or implement your own auth middleware in `functions/src/auth/middleware.ts`.

---

## 8. Verify Infrastructure

Before proceeding to database schema setup, verify that all three components are accessible:

```bash
# 1. Database connection
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;"

# 2. Backend health (start locally if not deployed)
cd functions && npm run serve
# In another terminal:
curl http://localhost:8080/api/health

# 3. Frontend (start locally if not deployed)
cd web && npm run dev
# Open http://localhost:5173 in a browser
```

---

## Next Step

[02-database-schema.md -- Database Schema Setup](02-database-schema.md)
