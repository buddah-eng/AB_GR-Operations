# Demo Mode (Public-Facing Deployment)

> Demo mode is a frontend-only deployment pattern for public demonstrations.
> Reads come from the real Postgres backend (seeded with example data).
> Writes are intercepted by the frontend and stored in localStorage.
> The shared database stays clean for all visitors. This is the ONLY file specific to the demo deployment pattern.

---

## Why Demo Mode Exists

When showcasing GR-Ops publicly (at a conference talk, on a portfolio site, or for evaluation), you want visitors to be able to interact with the full UI -- create guests, edit records, modify prep items -- without those changes polluting the shared database that every other visitor sees.

Demo mode solves this by intercepting all write operations on the frontend and routing them to the browser's localStorage instead of the API.

---

## Architecture

```
Normal Mode:
  Browser ──GET/POST/PUT/DELETE──> Express API ──> Postgres
                                                     |
                                                     v
                                                   (data persists)

Demo Mode:
  Browser ──GET──> Express API ──> Postgres (read-only, seeded data)
  Browser ──POST/PUT/DELETE──> localStorage (browser-local, per-visitor)
                                    |
                                    v
                                  (isolated, ephemeral)
```

Each visitor gets their own isolated write layer. When they read data, they see the seeded baseline merged with their local modifications. When they write, only their localStorage changes. Other visitors are unaffected.

---

## How It Works

### 1. Environment Variable

Demo mode is activated by setting `VITE_DEMO_MODE=true` in the frontend build.

In `web/src/api/client.ts`:

```typescript
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
```

### 2. Client Adapter

When demo mode is active, the `api` export proxies through a demo adapter instead of the real HTTP client. The adapter is built lazily at app startup via `initDemoClient()` in `web/src/main.ts`.

The demo adapter (`buildDemoAdapter()` in `web/src/api/client.ts`) implements the same interface as the real client:

| Method | Demo Behavior |
|--------|--------------|
| `api.get()` | Routes to the demo store, which reads from seeded data merged with localStorage overrides |
| `api.post()` | Creates a record in the demo store (localStorage), returns a synthetic write result |
| `api.put()` | Updates a record in the demo store (localStorage) |
| `api.del()` | Marks a record as deleted in the demo store (localStorage) |
| `api.call()` | Routes legacy action calls to the appropriate demo store method |

### 3. Demo Store

The demo store (imported as `@/demo/demo-store`) manages the in-browser data layer:

- **Seeded data** -- loaded once from a JSON fixture or the API at startup
- **Local overrides** -- stored in `localStorage` as a JSON object
- **Merge logic** -- reads return seeded data with local overrides applied; deleted records are filtered out
- **Collections** -- maps concept keys to data arrays: `guests`, `staff`, `schedule`, `venues`, `pairings`, `prepItems`, `transport`, `contracts`

### 4. Path Mapping

The demo adapter maps API paths to collection keys:

| API Path | Collection |
|----------|------------|
| `/api/domains/guest` | `guests` |
| `/api/domains/staff` | `staff` |
| `/api/domains/schedule` | `schedule` |
| `/api/domains/venue` | `venues` |
| `/api/domains/pairing` | `pairings` |
| `/api/domains/prep` | `prepItems` |
| `/api/domains/transport` | `transport` |
| `/api/domains/contract` | `contracts` |

### 5. Legacy Action Mapping

For `api.call()` (legacy GAS-style endpoints), the demo adapter handles:

| Action | Demo Store Method |
|--------|------------------|
| `getUserRole` | Returns `{ role: 'director' }` (full access) |
| `getDashboardData` | Returns aggregated dashboard stats |
| `getGuestList` | Returns `guests` collection |
| `getStaffList` | Returns `staff` collection |
| `getScheduleList` | Returns `schedule` collection |
| `getPrepItems` | Returns `prepItems` collection |
| `getGuestDetail` | Returns guest + related data |
| `createStaff` | Creates in localStorage |
| `updateGuest` | Updates in localStorage |
| `updatePrepItem` | Updates in localStorage |
| `createScheduleEvent` | Creates in localStorage |
| `createPairing` | Creates in localStorage |
| `deletePairing` | Deletes from localStorage |
| `createTravel` | Creates in localStorage |

---

## Setting Up Demo Mode

### Step 1: Seed the Database

Follow [07-populate-data.md](07-populate-data.md) to populate the Postgres database with example data. This becomes the read-only baseline for all demo visitors.

### Step 2: Build with Demo Mode Enabled

```bash
cd web
VITE_DEMO_MODE=true \
VITE_API_BASE_URL=https://your-api.example.com \
npm run build
```

Or create a `.env.demo` file:

```env
VITE_DEMO_MODE=true
VITE_API_BASE_URL=https://your-api.example.com
VITE_DEV_BYPASS_AUTH=true
```

And build with:

```bash
cd web
cp .env.demo .env.local
npm run build
```

### Step 3: Deploy the Static Build

Deploy `web/dist/` to any static hosting. The backend does not need any special configuration -- it serves reads normally.

**Vercel note:** Set `VITE_DEMO_MODE=true` in the Vercel dashboard environment variables. The build will pick it up automatically.

---

## Import/Export

Demo mode supports downloading and uploading local modifications so visitors can save their work across sessions or share configurations.

### Export (Download Local Modifications)

The demo store provides an export function that serializes all localStorage overrides as a JSON file:

```typescript
// In a Vue component or composable
import { demoStore } from '@/demo/demo-store'

function exportData() {
  const data = demoStore.exportLocalChanges()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  // trigger download...
}
```

### Import (Upload Previously Exported Data)

```typescript
function importData(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const data = JSON.parse(reader.result as string)
    demoStore.importLocalChanges(data)
    // reload the UI...
  }
  reader.readAsText(file)
}
```

---

## Reset

Clear all local modifications and return to the seeded baseline:

```typescript
demoStore.clearLocalChanges()
// Or simply:
localStorage.clear()
location.reload()
```

---

## What Demo Mode Does NOT Do

- It does not modify the backend or database in any way.
- It does not implement real authentication -- demo mode always operates as `director` role with full access.
- It does not persist data across browsers or devices (localStorage is browser-local).
- It does not handle concurrent modifications between tabs (each tab has its own view of localStorage).
- It does not support real-time collaboration features (if added in the future).

---

## When to Use Demo Mode

| Scenario | Use Demo Mode? |
|----------|---------------|
| Public portfolio or showcase site | Yes |
| Conference talk or live demo | Yes |
| Evaluation by a potential adopter | Yes |
| Internal development and testing | No -- use the real API |
| Production deployment for your convention | No -- use the real API |
| Integration testing | No -- use Docker + real Postgres |

---

## Verification

After deploying in demo mode:

1. Open the site in a browser. You should see seeded data (guests, staff, schedule).
2. Create a new guest. The guest should appear in the list.
3. Open the site in a different browser or incognito window. The new guest should NOT appear (it is localStorage-local).
4. In the first browser, refresh the page. The new guest should still appear (localStorage persists).
5. Clear localStorage (or use the reset function). The new guest should disappear.

---

## Next Step

[09-verification.md -- Launch Verification](09-verification.md)
