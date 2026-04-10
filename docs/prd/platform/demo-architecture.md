# Demo Architecture

> The demo IS the real app deployed with `VITE_DEMO_MODE=true`. Reads hit real Postgres (Neon on
> Vercel). Writes are intercepted by a single localStorage adapter (`demo-store.ts`) so the shared
> DB stays clean. Import/export lets users save and restore their session. Reset clears localStorage
> and returns to seed data. No mock HTTP layers, no separate codebase, no parallel demo universe.

---

## Overview

The demo deployment is the production GR-Ops Vue SPA running against a real Neon Postgres database via real Vercel Functions. The only behavioral difference is write interception: when `VITE_DEMO_MODE=true`, all create/update/delete operations are diverted to localStorage instead of hitting the API. Reads always come from the real database, merged with any local modifications the user has made.

The entire demo-specific infrastructure is one file: `demo-store.ts`. This file provides a localStorage-backed CRUD overlay that intercepts writes, generates client-side UUIDs for new records, tracks updates as patches against DB records, and marks deletions as hidden. The API client checks the `VITE_DEMO_MODE` flag and routes write operations through the demo store instead of the API.

Import/export is two methods on the demo store. Reset clears localStorage. No `demo-client.ts`, no `demo-state.ts`, no `DemoBar.vue`, no temporal state transforms, no mock API layer. If a view looks boring, the fix goes into the production view on main -- not into demo-specific overrides.

**Dependencies:** `platform/architecture.md` (system layers), `platform/branding.md` (theme config), `api/domain-crud.md` (API surface being intercepted), `data/postgres-schema.md` (schema the reads query against)

**Referenced by:** `platform/demo-showcase.md` (narrative and scenarios), `process/demo-data-integrity.md`, `process/demo-narrative-quality.md`, `process/demo-visual-impact.md`

---

## Full Specification

### 1. Hybrid Read/Write Architecture

**Purpose:** Define how the demo reads real data from Postgres and intercepts writes to localStorage.

**Detail:**

The demo operates on a hybrid model:

| Operation | Demo Mode | Production Mode |
|-----------|-----------|-----------------|
| GET (list, detail) | Real API call to Vercel Function, which queries Neon Postgres. Response merged with localStorage overlay. | Real API call. No overlay. |
| POST (create) | Intercepted before API call. Record stored in localStorage with client-generated UUID. Returns the created record immediately. | Real API call. |
| PUT/PATCH (update) | Intercepted before API call. Patch stored in localStorage keyed by record ID. Returns the merged record immediately. | Real API call. |
| DELETE | Intercepted before API call. Record ID added to a hidden-records set in localStorage. Returns success immediately. | Real API call. |

The interception happens in the API client layer (`web/src/api/client.ts`). The client checks `import.meta.env.VITE_DEMO_MODE === 'true'` once at module initialization and stores the result. All subsequent calls use this cached flag to determine routing.

```
Read path:  Vue component → Pinia store → api/client.ts → HTTP GET → Vercel Function → Postgres
                                                                                         ↓
                                                              api/client.ts merges localStorage overlay
                                                                                         ↓
                                                              Vue component receives merged data

Write path: Vue component → Pinia store → api/client.ts → demo-store.ts → localStorage
                                                              ↓
                                                         Returns immediately
                                                         (no network call)
```

**Read merging rules:**

1. Fetch records from the real API (always)
2. For each record in the response, check if localStorage has a patch for that record's ID
3. If patched: spread the DB record, then spread the patch on top (patch wins)
4. If deleted: exclude the record from the result set
5. Append any locally-created records (those with client-generated UUIDs not in the DB response)
6. Return the merged result set

**Acceptance Criteria:**
- [ ] GET requests always hit the real API endpoint -- never short-circuited or cached locally
- [ ] POST/PUT/DELETE requests never reach the API in demo mode -- zero network calls for writes
- [ ] Locally created records appear in subsequent list reads
- [ ] Locally updated records show the updated fields in subsequent detail reads
- [ ] Locally deleted records do not appear in subsequent list reads
- [ ] The shared Neon Postgres database contains zero demo user mutations after any demo session

---

### 2. Demo Store (`demo-store.ts`)

**Purpose:** Define the single file that manages all demo write state.

**Detail:**

Location: `web/src/demo/demo-store.ts`

This is the only demo-specific file in the codebase. It exports a small set of pure functions and one initialization function. It does not import Vue, Pinia, PrimeVue, or any framework code -- it is a plain TypeScript module operating on localStorage.

**Data structure in localStorage:**

```typescript
// Key: 'gr-ops-demo-state'
// Value: JSON string of DemoState
interface DemoState {
  version: 1
  createdAt: string              // ISO timestamp of first write
  lastModifiedAt: string         // ISO timestamp of most recent write
  
  created: Record<string, DemoRecord[]>
  // Keyed by concept (e.g., 'guest', 'pairing')
  // Each entry is a full record with a client-generated UUID
  
  updated: Record<string, Record<string, Partial<DemoRecord>>>
  // Keyed by concept, then by record ID
  // Each entry is a partial patch (only changed fields)
  
  deleted: Record<string, string[]>
  // Keyed by concept
  // Each entry is an array of record IDs to hide
}

type DemoRecord = Record<string, unknown> & { id: string }
```

**Exported API:**

```typescript
// Initialize: load state from localStorage or return empty state
function initDemoStore(): DemoState

// Write operations
function createRecord(state: DemoState, concept: string, data: Omit<DemoRecord, 'id'>): { state: DemoState, record: DemoRecord }
function updateRecord(state: DemoState, concept: string, id: string, patch: Partial<DemoRecord>): { state: DemoState, record: Partial<DemoRecord> }
function deleteRecord(state: DemoState, concept: string, id: string): { state: DemoState }

// Read overlay
function applyOverlay(state: DemoState, concept: string, dbRecords: DemoRecord[]): DemoRecord[]

// Persistence
function saveDemoState(state: DemoState): void
function loadDemoState(): DemoState | null

// Import/export
function exportDemoState(state: DemoState): string   // Returns JSON string
function importDemoState(json: string): DemoState     // Parses and validates JSON
function resetDemoState(): DemoState                  // Returns fresh empty state

// Utility
function generateDemoId(): string                    // crypto.randomUUID()
```

**Immutability:** Every write function returns a new `DemoState` object. The input state is never mutated. The caller is responsible for calling `saveDemoState()` with the returned state.

**ID generation:** Uses `crypto.randomUUID()` for client-side UUIDs. These IDs are prefixed with `demo-` to distinguish them from real database UUIDs in debugging and to prevent collisions.

**Size constraints:** localStorage has a ~5MB limit per origin. The demo store includes a size check before each write. If the state exceeds 4MB, the store logs a warning to the console and returns the state unchanged (write rejected). The UI shows a toast: "Demo storage limit reached. Export your data and reset to continue."

**Acceptance Criteria:**
- [ ] `demo-store.ts` is a single file under 200 lines
- [ ] All functions are pure (no side effects except `saveDemoState` and `loadDemoState`)
- [ ] State is immutable -- every write returns a new object
- [ ] Client-generated IDs use `demo-` prefix
- [ ] Size guard prevents writes beyond 4MB
- [ ] State version field enables future migrations

---

### 3. API Client Integration

**Purpose:** Define how the existing API client routes to the demo store.

**Detail:**

The API client (`web/src/api/client.ts`) already provides the interface for all data operations. In demo mode, the client wraps write operations:

```typescript
// web/src/api/client.ts

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

// For GET requests: fetch from API, then apply overlay
async function list(concept: string, params?: QueryParams): Promise<ApiResponse> {
  const response = await httpGet(`/api/domains/${concept}`, params)
  if (IS_DEMO) {
    const state = loadDemoState() ?? initDemoStore()
    return {
      ...response,
      data: applyOverlay(state, concept, response.data)
    }
  }
  return response
}

// For POST requests: intercept entirely in demo mode
async function create(concept: string, data: Record<string, unknown>): Promise<ApiResponse> {
  if (IS_DEMO) {
    const state = loadDemoState() ?? initDemoStore()
    const { state: newState, record } = createRecord(state, concept, data)
    saveDemoState(newState)
    return { success: true, data: record }
  }
  return httpPost(`/api/domains/${concept}`, data)
}

// PUT and DELETE follow the same pattern
```

**No behavioral changes outside demo mode.** When `VITE_DEMO_MODE` is not `'true'`, the API client is identical to production. Zero demo-related code paths execute.

**Acceptance Criteria:**
- [ ] API client checks `VITE_DEMO_MODE` exactly once at module load, not per request
- [ ] Read operations always make a real HTTP call, even in demo mode
- [ ] Write operations make zero HTTP calls in demo mode
- [ ] Production mode code paths contain zero references to demo store

---

### 4. DEMO_MODE Flag

**Purpose:** Define the environment variable and its effects on the application.

**Detail:**

**Environment variable:** `VITE_DEMO_MODE=true`

Set in the Vercel project's environment variables for the `demo` branch deployment. Not present in the main branch deployment or local development (unless explicitly set).

**Detection:** Checked at app startup via `import.meta.env.VITE_DEMO_MODE`. Vite inlines this at build time -- there is no runtime environment lookup.

**Effects when `VITE_DEMO_MODE=true`:**

| Behavior | How |
|----------|-----|
| Write interception | API client routes writes to demo store (Section 3) |
| Demo banner visible | App.vue renders the demo banner bar (Section 5) |
| Auth bypassed | Auth middleware returns a pre-configured demo user (no Firebase login) |
| Import/export/reset buttons visible | Rendered in the demo banner bar |

**Effects when `VITE_DEMO_MODE` is absent or not `'true'`:**

| Behavior | How |
|----------|-----|
| Normal write path | API client sends writes to Vercel Functions |
| No banner | Banner component not rendered |
| Normal auth | Firebase OAuth login required |
| No import/export buttons | Not rendered |

**Demo user identity:**

When auth is bypassed in demo mode, the app uses a hardcoded demo user profile:

```typescript
const DEMO_USER = {
  uid: 'demo-user',
  email: 'demo@gr-ops.dev',
  displayName: 'Demo User',
  role: 'admin'   // Full access to all views
}
```

This user has the `admin` role so all views, builder pages, and settings are accessible. The demo is a showcase of the full platform -- restricting access defeats the purpose.

**Acceptance Criteria:**
- [ ] `VITE_DEMO_MODE=true` is the only flag needed to enable demo mode (no other env vars required)
- [ ] Auth is fully bypassed in demo mode -- no login screen, no Firebase dependency
- [ ] Demo user has admin-level access to all views
- [ ] Removing `VITE_DEMO_MODE` from the environment completely disables all demo behavior
- [ ] No demo-related code is tree-shaken into a production build (dead code elimination)

---

### 5. Demo Banner Bar

**Purpose:** Define the persistent UI indicator for demo mode.

**Detail:**

A thin bar fixed to the top of the viewport, above the main app header. Always visible while scrolling. Cannot be dismissed.

**Content:**

```
[GR-Ops icon] Demo Mode -- Exploring GR-Ops with sample data    [Import] [Export] [Reset]
```

**Styling:**
- Height: 36px
- Background: `primary-600` with 90% opacity
- Text: white, `font-sans` (Lato), 13px
- Buttons: outlined white, small (24px height), hover brightens
- Position: `fixed`, `top-0`, `left-0`, `right-0`, `z-50`
- The main app content shifts down by 36px via a top padding/margin when in demo mode

**Implementation:**

Not a separate component file. A `v-if="isDemoMode"` block inside `App.vue`, rendering a `<div>` with the banner content. This keeps the demo-specific surface minimal -- no `DemoBar.vue`, no `DemoBanner.vue`.

**Acceptance Criteria:**
- [ ] Banner visible on every page in demo mode
- [ ] Banner not rendered (not just hidden) in production mode
- [ ] Import, Export, and Reset buttons are functional (wired to demo store methods)
- [ ] Banner does not overlap or obscure app content
- [ ] Banner renders correctly on mobile (buttons may stack or use icons only)

---

### 6. Import/Export/Reset

**Purpose:** Define how users save, restore, and reset their demo session.

**Detail:**

Three operations, each triggered by a button in the demo banner bar.

**Export:**

1. User clicks "Export"
2. Call `exportDemoState(state)` which returns a JSON string
3. Create a `Blob` from the JSON string with MIME type `application/json`
4. Trigger a browser download with filename `gr-ops-demo-{timestamp}.json`
5. Show a success toast: "Demo data exported"

The exported JSON includes the full `DemoState` object: all created records, all patches, all deletion markers, the version number, and timestamps.

**Import:**

1. User clicks "Import"
2. Browser file picker opens, filtered to `.json` files
3. File contents read via `FileReader`
4. Call `importDemoState(json)` which:
   - Parses the JSON
   - Validates the `version` field matches the current schema version
   - Validates the structure (created/updated/deleted keys exist and are correct types)
   - Returns the validated `DemoState`
5. Call `saveDemoState(importedState)` to persist
6. Reload the current page to reflect imported data
7. Show a success toast: "Demo data imported"

If validation fails, show an error toast: "Invalid demo file. Expected a GR-Ops demo export." Do not overwrite existing state on failure.

**Reset:**

1. User clicks "Reset"
2. Show a confirmation dialog: "Reset demo to original sample data? Your changes will be lost."
3. If confirmed:
   - Call `resetDemoState()` which clears the localStorage key and returns a fresh empty state
   - Reload the current page
   - Show a success toast: "Demo reset to sample data"
4. If canceled: no action

**Acceptance Criteria:**
- [ ] Export produces a valid JSON file that can be re-imported
- [ ] Import validates the file before overwriting state
- [ ] Import of a corrupted or non-demo file shows an error and does not modify state
- [ ] Reset clears all local modifications and returns to seed data (from DB)
- [ ] Reset requires confirmation before executing
- [ ] Round-trip: export then import produces identical state
- [ ] Exported file includes a human-readable timestamp and version for identification

---

### 7. Data Loading Performance

**Purpose:** Ensure the demo loads data immediately with no blank states.

**Detail:**

The demo must never show empty tables, loading spinners that persist, or "No data" placeholders. Every page must render meaningful content within the first paint.

**How this is achieved:**

1. **Real API calls are fast.** Neon Postgres on Vercel responds in 50-200ms for the seeded dataset (~200 total records). This is fast enough for immediate rendering.

2. **Optimistic rendering.** The Vue app does not gate page rendering on API responses. The page layout renders immediately, and data populates as API responses arrive. PrimeVue DataTable, card views, and timeline views all handle this pattern natively.

3. **Parallel fetches.** Dashboard widgets, list views, and related data load in parallel (not sequentially). The ontology store loads at app startup in `main.ts` and is cached -- subsequent page navigations do not re-fetch it.

4. **localStorage overlay is synchronous.** The demo store reads and writes are synchronous localStorage operations. Applying the overlay to API responses adds zero latency.

5. **No additional demo-specific caching.** The real API response is the data source. No prefetching, no local JSON fixtures, no static imports. If the API is slow, that is a real infrastructure issue to fix -- not a demo-specific concern.

**Failure mode:** If the Vercel Function or Neon Postgres is cold-starting, the first page load may take 1-3 seconds. This is acceptable for a free-tier deployment. Subsequent navigations will be fast because the serverless function stays warm.

**Acceptance Criteria:**
- [ ] Every page renders data within 3 seconds on first load (cold start allowance)
- [ ] Every page renders data within 500ms on subsequent navigations (warm function)
- [ ] No page shows "No data" or a blank table when seed data exists for that concept
- [ ] Ontology config loads once at startup and is not re-fetched per page

---

### 8. What This Is NOT

**Purpose:** Explicitly define the boundaries of this PRD to prevent scope creep and anti-pattern recurrence.

**Detail:**

This PRD defines the demo's read/write architecture and state management. It does NOT cover:

| Not This PRD | Where It Lives | Why Separate |
|---|---|---|
| What data is seeded (guest names, venues, prep items, temporal states) | `platform/demo-showcase.md` | Data design is a narrative concern, not an architecture concern |
| How the demo is deployed to Vercel (branch strategy, build pipeline, domain) | `platform/demo-deployment.md` (to be written) | Deployment infrastructure is separate from runtime architecture |
| The demo completion verification protocol | `process/demo-data-integrity.md`, `process/demo-narrative-quality.md`, `process/demo-visual-impact.md` | Process PRDs are evergreen and phase-independent |
| The full demo showcase narrative (pre/during/post event views, canvas walkthrough) | `platform/demo-showcase.md` (to be rewritten) | Narrative and user experience is a separate concern |

**What was explicitly deleted and must not return:**

| Deleted Artifact | Lines | Why Deleted |
|---|---|---|
| `demo-client.ts` | 504 | Mock HTTP layer that broke every time a new view was added. Infinite bug surface. |
| `demo-state.ts` | ~200 | Parallel state management that duplicated Pinia stores. |
| `DemoBar.vue` | ~80 | Separate component file for a 36px bar. Overkill -- belongs inline in App.vue. |
| `demo-import-export.ts` | ~100 | Separate module for two utility functions. Import/export are methods on demo-store. |
| Temporal state transforms | ~150 | Pre/during/post-event state computed from seed data transforms. Seed data should already be in the correct state. |
| Static HTML demo on GitHub Pages | N/A | SPA routing broken, no server functions, dashboard showed "data loading" forever. |

The diff between the demo branch and main should be minimal:
- `demo-store.ts` (new file, ~150-200 lines)
- `api/client.ts` (conditional write routing, ~30 lines changed)
- `App.vue` (demo banner `v-if` block, ~20 lines added)
- `main.ts` or auth guard (demo user bypass, ~10 lines changed)
- `vercel.json` (deployment config, on demo branch only)
- Seed data scripts (in `functions/` or `scripts/`, shared with main)

**Acceptance Criteria:**
- [ ] No file named `demo-client.ts`, `demo-state.ts`, `DemoBar.vue`, or `demo-import-export.ts` exists in the codebase
- [ ] Demo branch differs from main by fewer than 300 lines (excluding seed data)
- [ ] No mock HTTP interception layer exists (no `msw`, no fetch mocks, no XMLHttpRequest overrides)

---

### 9. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Demo store CRUD | Unit | `createRecord`, `updateRecord`, `deleteRecord` return correct state | All mutations produce expected output |
| Overlay merge | Unit | `applyOverlay` correctly merges created/updated/deleted with DB records | Created appended, updated merged, deleted excluded |
| ID generation | Unit | `generateDemoId` returns `demo-` prefixed UUID | Format matches `demo-{uuid}` |
| Size guard | Unit | Write rejected when state exceeds 4MB | Returns unchanged state, no throw |
| Import validation | Unit | `importDemoState` rejects malformed JSON, wrong version, missing keys | Returns error for invalid input, valid state for valid input |
| Round-trip | Unit | Export then import produces identical state | Deep equality check passes |
| API client routing | Integration | Write calls in demo mode hit demo store, not HTTP | Network inspector shows zero POST/PUT/DELETE requests |
| API client reads | Integration | GET calls in demo mode hit real API | Network inspector shows GET requests to Vercel |
| Overlay in reads | Integration | Created/updated/deleted records reflected in list view | UI shows merged data |
| Banner visibility | E2E | Demo mode shows banner, production mode does not | Banner DOM element present/absent |
| Export download | E2E | Click export, file downloads with correct content | File contains valid DemoState JSON |
| Import upload | E2E | Click import, select file, state loads correctly | Previously exported data restored |
| Reset confirmation | E2E | Click reset, confirm, state cleared | localStorage empty, page shows seed data only |
| No blank states | E2E | Navigate every page in demo mode | Every page shows data (no empty tables, no "No data") |

**Coverage target:** 90% on `demo-store.ts` (it is the only demo-specific file and must be bulletproof). 80% on API client demo-mode branches.

**TDD approach:** Write tests for `demo-store.ts` before implementation. The store's API is pure functions with well-defined inputs and outputs -- ideal for test-first development.
