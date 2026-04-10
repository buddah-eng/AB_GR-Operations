# GR-Ops -- Convention Operations Platform

GR-Ops is an ontology-driven, RBAC-enforced, API-first convention operations platform where source code is the engine and the database is the application. One deployment serves every department -- isolated by ontology scoping and role-based access control. Built for Anime Boston, but designed to work for any convention.

**OSS-safe:** fork the repo, deploy, and populate your own ontology. No convention-specific logic is hardcoded.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, TypeScript, Express, PostgreSQL, Firebase Functions |
| Frontend | Vue 3, PrimeVue 4, FormKit, Vue Flow, Tailwind CSS, Pinia |
| Testing | Vitest (unit), Testcontainers + PostgreSQL (integration) |
| CI | GitHub Actions |
| Typography | M PLUS 1 (display) + Lato (body) |

## Prerequisites

- **Node.js 20+**
- **Docker** (for integration tests and local Postgres)
- **Firebase CLI** (`npm install -g firebase-tools`)

## Quick Start

```bash
# Clone
git clone https://github.com/buddah-eng/AB_GR-Operations.git
cd AB_GR-Operations

# Backend
cd functions
npm install
npm test                    # unit tests (no Docker needed)
npm run test:integration    # integration tests (Docker required)
npm run build               # compile TypeScript
npm run serve               # start Firebase emulator

# Frontend
cd ../web
npm install
npm run dev                 # start Vite dev server
```

## Environment Variables

### Backend (`functions/`)

| Variable | Description | Required |
|----------|-------------|----------|
| `DB_HOST` | PostgreSQL host | Yes |
| `DB_PORT` | PostgreSQL port (default: 5432) | No |
| `DB_NAME` | PostgreSQL database name | Yes |
| `DB_USER` | PostgreSQL user | Yes |
| `DB_PASSWORD` | PostgreSQL password | Yes |
| `ENCRYPTION_KEY` | 64-char hex string for PII encryption | Optional in dev |
| `HMAC_KEY` | 64-char hex string for blind index | Optional in dev |

### Frontend (`web/`)

| Variable | Description | Default |
|----------|-------------|---------|
| `CONVENTION_NAME` | Convention name shown in UI | `"Convention"` |
| `VITE_PRIMARY_50` ... `VITE_PRIMARY_950` | Primary color scale overrides | Slate blue (OSS neutral) |
| `VITE_ACCENT_50` ... `VITE_ACCENT_900` | Accent color scale overrides | Warm amber (OSS neutral) |

## Project Structure

```
AB_GR-Operations/
  functions/               # Backend (Firebase Functions + Express)
    src/
      api/                 # Express route handlers
      auth/                # Authentication & authorization
      db/                  # Database pool, queries, migrations
      encryption/          # PII encryption utilities
      ontology/            # Ontology definitions & scoping
      roles/               # RBAC role definitions
      services/            # Business logic layer
      workflows/           # Workflow engine
      __tests__/           # Unit & integration tests
    lib/                   # Compiled output
  web/                     # Frontend (Vue 3 SPA)
    src/
      api/                 # API client
      components/          # Vue components
      composables/         # Vue composables (hooks)
      router/              # Vue Router config
      stores/              # Pinia stores
      styles/              # Design tokens & global CSS
      types/               # TypeScript type definitions
      views/               # Page-level view components
  docs/
    index.html             # Static demo page (GitHub Pages)
    prd/                   # 80+ PRDs across 12 domain folders
  .github/workflows/       # CI pipeline
  firebase.json            # Firebase hosting & functions config
```

## Database Setup

```bash
# Start Postgres via Docker
docker run -d \
  --name gr-ops-db \
  -p 5432:5432 \
  -e POSTGRES_DB=gr_ops \
  -e POSTGRES_PASSWORD=dev \
  postgres:16-alpine

# Run migrations
cd functions
DB_HOST=localhost DB_PASSWORD=dev npx ts-node src/__tests__/helpers/migrate.ts
```

## Testing

```bash
cd functions

# Unit tests (~1345 tests, no Docker needed)
npm test

# Integration tests (~62 tests, Docker required)
npm run test:integration

# All tests
npm run test:all

# Coverage report
npm run test:coverage
```

CI runs both unit and integration test suites on every push to `main` and `dev/*` branches, and on pull requests to `main`.

## Applying Convention Branding

GR-Ops ships with a neutral OSS palette (slate blue primary, warm amber accent). To apply your own convention branding:

1. **Environment variables** -- set `VITE_PRIMARY_*` and `VITE_ACCENT_*` to override the color scale at build time.

2. **CSS theme class** -- add the `.theme-ab` class to `<html>` for the Anime Boston blue + orange palette (or create your own theme class in `web/src/styles/design-tokens.css`).

3. **Logo** -- upload via the Settings UI, or replace `web/public/placeholder-logo.svg`.

4. **Convention name** -- set the `CONVENTION_NAME` environment variable.

## License

[AGPL-3.0](LICENSE)

## Contributing

This project uses a PRD-driven development process. See `docs/prd/` for the full specification library organized by domain:

- `core/` -- foundational data model & ontology PRDs
- `api/` -- REST API design
- `ui/` -- frontend component specifications
- `data/` -- data quality, lineage, routing
- `platform/` -- observability, caching, versioning
- `process/` -- completion protocol & workflow PRDs

Each PRD follows a structured template. When contributing a new feature, start by reading the relevant PRDs and the orchestration guide at `docs/prd/_orchestration.md`.
