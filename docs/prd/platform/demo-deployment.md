# Demo Deployment

> Vercel hosting on free tier with Neon Postgres. Demo branch on GitHub auto-deploys on push.
> Vue 3 SPA + Express API via Vercel Functions. No GitHub Pages (SPA routing, no server functions, no Postgres).
> Public URL, no login required, HTTPS automatic.

---

## Overview

The demo is the real GR-Ops app deployed with `VITE_DEMO_MODE=true` on Vercel's free tier. The Vue 3 frontend is served as a static SPA. The Express API routes are deployed as Vercel Functions, reading from an already-provisioned Neon Postgres database seeded with authentic Anime Boston data. A dedicated `demo` branch on GitHub is connected to Vercel for automatic deployment on every push. The main development branch (`dev/phase-a-foundation`) is never destabilized by demo work -- the demo branch rebases on main to inherit improvements, and demo-specific changes (seed data, demo-mode flag) live only on the demo branch.

GitHub Pages is explicitly disqualified: it cannot handle SPA routing without hash-mode hacks, it cannot run server functions for Postgres reads, and it cannot serve API routes. Vercel solves all three with zero configuration beyond a `vercel.json` file.

**Dependencies:** `platform/demo-architecture.md` (hybrid read/write model, localStorage adapter, DEMO_MODE flag), `data/postgres-schema.md` (schema that Neon Postgres runs), `platform/architecture.md` (Express API layer)

**Requirements covered:** R57 (Vercel hosting), R10 (public demo accessibility)

---

## Full Specification

### 1. Vercel Project Configuration

**Purpose:** Define the Vercel project setup for the GR-Ops demo.

**Detail:**

The Vercel project hosts both the Vue 3 SPA (static files) and the Express API (Vercel Functions). The free Hobby tier is sufficient for demo traffic (no concurrent load, no SLA requirements).

**`vercel.json` (project root):**

```json
{
  "buildCommand": "cd web && npm run build",
  "outputDirectory": "web/dist",
  "installCommand": "cd web && npm install && cd ../functions && npm install",
  "framework": null,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "functions": {
    "api/**/*.ts": {
      "runtime": "@vercel/node@3"
    }
  }
}
```

**Key decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework preset | `null` (no framework) | Vue 3 + Vite is not auto-detected as a Vercel-native framework. Manual config is more reliable. |
| API routing | Vercel Functions in `api/` directory | Express routes adapted to Vercel's serverless function model via a single entrypoint handler. |
| SPA fallback | Rewrite `(.*)` to `/index.html` | All non-API routes serve the Vue SPA, enabling client-side routing with Vue Router in history mode. |
| Node runtime | Node 20 | Matches the `engines.node` field in `functions/package.json`. |

**Vercel Function entrypoint** (`api/index.ts`):

The existing Express app is exported as a Vercel Function. No rewrite of the API layer -- the same `functions/src/index.ts` Express app is wrapped in a Vercel-compatible handler.

```typescript
// api/index.ts
import app from '../functions/src/index'
export default app
```

This single entrypoint handles all `/api/*` routes through the existing Express router.

**Acceptance Criteria:**
- [ ] `vercel.json` exists in repo root with correct build, output, and rewrite config
- [ ] `vercel dev` runs locally and serves both SPA and API routes
- [ ] SPA routes (e.g., `/guests`, `/schedule`, `/canvas`) return `index.html` (not 404)
- [ ] API routes (e.g., `/api/domains/guest`) return JSON from Postgres

---

### 2. Neon Postgres Configuration

**Purpose:** Connect the Vercel deployment to the already-provisioned Neon database.

**Detail:**

Neon Postgres is already provisioned. The connection string is stored as a Vercel environment variable. The Express API reads `DATABASE_URL` at startup -- the same environment variable pattern used in local development.

**Environment variables (set in Vercel dashboard, not committed):**

| Variable | Value | Scope |
|----------|-------|-------|
| `DATABASE_URL` | `postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/grops?sslmode=require` | Production, Preview |
| `VITE_DEMO_MODE` | `true` | Production, Preview |
| `VITE_API_BASE_URL` | (empty -- relative `/api` paths) | Production, Preview |
| `NODE_ENV` | `production` | Production |

**Neon configuration:**

- **Project:** `gr-ops-demo` (already provisioned)
- **Branch:** `main` (Neon's default branch -- not to be confused with the Git branch)
- **Compute:** Free tier autosuspend (suspends after 5 minutes of inactivity, resumes on first query in ~1 second)
- **Region:** `us-east-2` (AWS Ohio -- closest free-tier region to Boston)

**Connection pooling:** Neon provides a pooled connection string (`-pooler` suffix) for serverless environments where each invocation is a fresh connection. Vercel Functions MUST use the pooled string to avoid exhausting Neon's connection limit (20 on free tier).

**Seed data:** The Neon database is seeded manually via `psql` or a seed script run from a developer's machine. Seed data is defined in `platform/demo-data-narrative.md` and materialized as SQL insert scripts in the repo under `setup/seeds/demo/`.

**Acceptance Criteria:**
- [ ] `DATABASE_URL` set as Vercel environment variable (not committed to repo)
- [ ] API routes successfully query Neon and return seeded data
- [ ] Pooled connection string used (verified by `-pooler` in connection URL)
- [ ] Cold start (after Neon autosuspend) completes in under 3 seconds
- [ ] No connection exhaustion errors under normal demo browsing

---

### 3. Demo Branch Strategy

**Purpose:** Define the Git branching model that keeps the demo deployable without destabilizing development.

**Detail:**

```
main (dev/phase-a-foundation)
  |
  |--- demo (deployed to Vercel)
  |      |
  |      +-- demo-specific commits (seed data, DEMO_MODE defaults, demo nav)
  |
  |--- feature branches (normal development)
```

**Rules:**

1. **The `demo` branch is a forward-only rebase of main.** It contains everything on main plus a small set of demo-specific commits on top.

2. **Demo-specific commits are clearly labeled.** Commit messages use the prefix `demo:` (e.g., `demo: seed pre-event transport bookings`, `demo: add temporal view switcher`).

3. **The demo branch is never merged into main.** It is a deployment-only branch. Demo-specific code stays on demo.

4. **Main improvements flow to demo via rebase:**
   ```bash
   git checkout demo
   git rebase dev/phase-a-foundation
   git push --force-with-lease origin demo
   ```
   Vercel auto-deploys the new demo branch state.

5. **Demo improvements that benefit main go as PRs to main.** If a demo change (e.g., better view rendering, canvas polish, bug fix) should be in the production app, it is cherry-picked or PR'd to main. The demo branch then inherits it on next rebase.

6. **Force-push is acceptable on demo.** This is a deployment branch, not a collaboration branch. No one else commits to it. `--force-with-lease` is used as a safety measure.

**Branch protection:**
- `demo` branch: no protection rules (single maintainer, force-push expected)
- `dev/phase-a-foundation`: standard protection (PR required, no force push)

**Acceptance Criteria:**
- [ ] `demo` branch exists on GitHub
- [ ] `demo` branch contains all commits from main plus demo-specific commits
- [ ] Demo-specific commits are prefixed with `demo:`
- [ ] Rebasing demo on main produces no conflicts (or conflicts are resolved in the rebase)
- [ ] Vercel deploys automatically when demo branch is pushed

---

### 4. Build Pipeline

**Purpose:** Define how Vercel builds and deploys the demo.

**Detail:**

Vercel's build pipeline runs automatically on every push to the `demo` branch. No custom CI/CD (no GitHub Actions, no manual builds, no committed build artifacts).

**Build steps (executed by Vercel):**

1. **Install:** `cd web && npm install && cd ../functions && npm install`
2. **Build frontend:** `cd web && VITE_DEMO_MODE=true npm run build`
   - Vite compiles the Vue 3 SPA with `import.meta.env.VITE_DEMO_MODE === 'true'`
   - Output: `web/dist/` (static HTML/CSS/JS)
3. **Build API:** TypeScript compilation of `functions/src/` for Vercel Functions
4. **Deploy:** Vercel serves `web/dist/` as static files, `api/` as serverless functions

**What is NOT in the pipeline:**
- No `docs/` folder deployment (legacy GitHub Pages approach -- disqualified)
- No committed build artifacts (`web/dist/` is in `.gitignore`)
- No manual `firebase deploy` (production path, not demo path)
- No Docker containers (Vercel handles the runtime)
- No database migrations (Neon schema managed separately via seed scripts)

**Build environment variables:**

Vercel injects environment variables from the dashboard into both the build step (for Vite) and the runtime (for Vercel Functions). `VITE_*` variables are compiled into the frontend bundle at build time. `DATABASE_URL` is available at runtime in Vercel Functions.

**Build verification:**

The build must succeed with zero TypeScript errors (`vue-tsc --noEmit` runs as part of `npm run build`). If the build fails, Vercel does not deploy and the previous deployment remains live.

**Acceptance Criteria:**
- [ ] Push to `demo` branch triggers Vercel build automatically
- [ ] Build completes in under 3 minutes
- [ ] `VITE_DEMO_MODE` is `true` in the built frontend bundle
- [ ] No build artifacts committed to the repo
- [ ] Failed builds do not take down the live demo

---

### 5. Public Accessibility

**Purpose:** Define the public-facing URL and access model for the demo.

**Detail:**

The demo is publicly accessible without authentication. No login screen, no email/password, no Firebase Auth. The `VITE_DEMO_MODE=true` flag bypasses the auth middleware on both the frontend (skips login redirect) and the backend (assigns a demo viewer role with read-only permissions).

**URL structure:**

| URL | What |
|-----|------|
| `https://gr-ops-demo.vercel.app/` | Demo landing (temporal view switcher) |
| `https://gr-ops-demo.vercel.app/guests` | Guest list (pre-event view by default) |
| `https://gr-ops-demo.vercel.app/schedule` | Schedule timeline |
| `https://gr-ops-demo.vercel.app/transport` | Transport dashboard |
| `https://gr-ops-demo.vercel.app/canvas` | Canvas walkthrough |
| `https://gr-ops-demo.vercel.app/api/domains/guest` | API endpoint (JSON) |

**Custom domain (optional):** A custom subdomain (e.g., `demo.gr-ops.dev`) can be configured in Vercel for a more professional URL. Free tier supports custom domains with automatic SSL.

**HTTPS:** Automatic via Vercel. No certificate management required. All traffic is HTTPS-only (HTTP redirects to HTTPS).

**CORS:** The API and frontend are on the same origin (`gr-ops-demo.vercel.app`), so no CORS configuration is needed for the demo. The existing CORS middleware in Express is preserved for development (localhost).

**Rate limiting:** Not required for demo. Vercel's built-in DDoS protection on the free tier is sufficient. If abuse occurs, Vercel's Edge network handles it.

**Demo mode auth bypass:**

```typescript
// functions/src/auth/middleware.ts
if (process.env.VITE_DEMO_MODE === 'true') {
  // Skip Firebase token verification
  // Assign demo_viewer role (read-only, all departments, all concepts)
  req.user = { uid: 'demo-user', email: 'demo@gr-ops.dev', displayName: 'Demo Viewer' }
  req.role = { key: 'demo_viewer', permissions: { /* read-only everything */ } }
  req.actorType = 'demo'
  return next()
}
```

**Acceptance Criteria:**
- [ ] Demo URL loads without any login prompt
- [ ] All page routes return the SPA (no 404 on direct URL access)
- [ ] HTTPS certificate is valid and auto-renewed
- [ ] API endpoints return data without authentication headers
- [ ] Demo viewer cannot modify data via API (write endpoints return 403 or demo toast)
- [ ] Direct URL sharing works (e.g., sending `https://gr-ops-demo.vercel.app/guests` to someone)

---

### 6. GitHub Pages Disqualification

**Purpose:** Document why GitHub Pages was rejected and prevent revisiting this decision.

**Detail:**

GitHub Pages was the original deployment target (referenced in `platform/demo-showcase.md`). It is disqualified for the following reasons:

| Requirement | GitHub Pages | Vercel |
|-------------|-------------|--------|
| SPA routing (history mode) | Broken. Returns 404 on direct URL access to `/guests`, `/schedule`, etc. Requires hash-mode routing (`/#/guests`) which breaks URL sharing and looks unprofessional. The `404.html` redirect hack is fragile. | Native. Rewrite rules serve `index.html` for all non-API routes. History mode works correctly. |
| Server functions (API routes) | None. GitHub Pages is static-only. Cannot run Express, cannot query Postgres. | Vercel Functions. Express app runs as serverless function with full Node.js runtime. |
| Postgres reads | Impossible. No server-side code execution. Demo would need mocked JSON files instead of real database queries. | Direct connection to Neon Postgres via `DATABASE_URL`. Real queries, real data. |
| Build pipeline | Manual. Must commit build artifacts to `docs/` or `gh-pages` branch. | Automatic. Push to branch triggers build and deploy. No committed artifacts. |
| SSL/HTTPS | Automatic (for `*.github.io` domains). | Automatic (for `*.vercel.app` and custom domains). |
| Custom domain | Supported. | Supported. |

**The fundamental issue:** GitHub Pages cannot run server-side code. The demo's value proposition is showing the real platform reading real data from Postgres -- not a mocked static approximation. Without Vercel Functions (or equivalent), the demo would require a completely separate mock data layer, defeating the purpose of "the demo IS the real app."

**Acceptance Criteria:**
- [ ] No references to GitHub Pages in demo deployment documentation
- [ ] No `docs/` folder deployment configuration in the repo
- [ ] No `gh-pages` branch exists

---

### 7. Preview Deployments

**Purpose:** Define how PRs to the demo branch get preview URLs.

**Detail:**

Vercel automatically creates a preview deployment for every PR targeting the `demo` branch. This allows reviewing demo changes before they go live.

**Preview deployment behavior:**
- Unique URL per PR (e.g., `gr-ops-demo-abc123.vercel.app`)
- Same environment variables as production (including `DATABASE_URL` pointing to Neon)
- Auto-deleted after PR is merged or closed
- Useful for reviewing seed data changes, UI tweaks, or narrative adjustments before pushing to the live demo

**For PRs targeting main:** Preview deployments are NOT configured for the main development branch. Only the `demo` branch has Vercel deployment. Development uses `firebase emulators:start` locally.

**Acceptance Criteria:**
- [ ] PRs to `demo` branch generate preview URLs
- [ ] Preview deployments read from the same Neon database
- [ ] Preview URLs are shareable for review

---

### 8. Monitoring and Maintenance

**Purpose:** Define the operational posture for the demo deployment.

**Detail:**

The demo is a showcase, not a production system. Operational overhead should be near zero.

**Monitoring:**
- Vercel dashboard shows deployment status, function invocations, and errors
- Neon dashboard shows database queries, connection count, and storage usage
- No external monitoring tools required (Datadog, Sentry, etc.)

**Maintenance tasks:**

| Task | Frequency | How |
|------|-----------|-----|
| Rebase demo on main | After each phase completion or significant main branch work | `git rebase dev/phase-a-foundation && git push --force-with-lease` |
| Reseed Neon database | When seed data changes (new narrative, data fixes) | Run seed script: `psql $DATABASE_URL < setup/seeds/demo/seed.sql` |
| Check Vercel build status | After each push to demo | Vercel dashboard or GitHub commit status checks |
| Rotate Neon credentials | Annually or if compromised | Update `DATABASE_URL` in Vercel environment variables |

**Cost:**
- Vercel Hobby tier: $0/month (100GB bandwidth, 100 hours function execution)
- Neon free tier: $0/month (0.5 GB storage, 190 compute hours/month, autosuspend)
- Custom domain (optional): $0 (bring your own domain, DNS only)
- **Total: $0/month**

**Acceptance Criteria:**
- [ ] Vercel dashboard accessible and showing deployment history
- [ ] Neon dashboard accessible and showing query activity
- [ ] Demo stays live with zero ongoing cost
- [ ] Rebase and reseed procedures documented and tested

---

### 9. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Vercel build | Integration | Push to demo branch triggers successful build | Build completes, deployment URL live |
| SPA routing | E2E | Navigate to `/guests`, `/schedule`, `/canvas` via direct URL | All routes return the Vue app (not 404) |
| API connectivity | Integration | `GET /api/domains/guest` from deployed URL | Returns JSON array of seeded guest records |
| Neon cold start | Performance | Hit API after 10 minutes of inactivity | Response in under 3 seconds |
| Demo auth bypass | Integration | Access all routes without authentication headers | No 401/403 errors, demo_viewer role applied |
| Write rejection | Integration | `POST /api/domains/guest` with demo body | Returns 403 or demo-mode rejection message |
| HTTPS | Security | Access via HTTP | Redirects to HTTPS |
| Preview deployment | Integration | Open PR to demo branch | Preview URL generated and functional |
| Rebase workflow | Manual | Rebase demo on main after a main branch commit | Demo branch has new commits, Vercel redeploys |
| Mobile access | E2E | Load demo URL on mobile viewport | Responsive layout, all navigation functional |

**Coverage target:** All tests are integration/E2E by nature (deployment verification). No unit tests needed for deployment configuration -- the deployment either works or it does not.
