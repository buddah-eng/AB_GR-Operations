# Branding & Theming

> Convention branding (colors, fonts, logo, org name) is config, not code. Stored in `platform_config` table
> or environment variables. Tailwind theme generated from config at build/runtime. Engine ships with a neutral
> default theme. Each convention applies their own branding via seed script or settings UI.

---

## Overview

The current codebase has Anime Boston branding hardcoded — `ab-*` color tokens in `tailwind.config.js`, logo files in `/web/public/`, font choices in both the Tailwind config and the demo HTML. For the platform to be OSS-safe, branding must be data (database or environment config), not source code. A convention deploying the platform should set their colors, fonts, and logo without modifying source files.

**Dependencies:** `data/postgres-schema.md` (platform_config table), `platform/oss-model.md` (what's in the repo vs DB)

---

## Full Specification

### 1. Current State

**Purpose:** Inventory what's hardcoded and needs to move to config.

| Asset | Location | What's Hardcoded |
|---|---|---|
| Primary color scale (`ab-*`) | `web/tailwind.config.js:14-28` | 11-step blue scale extracted from AB poster |
| Accent color scale (`accent-*`) | `web/tailwind.config.js:30-41` | 11-step orange scale from AB logo |
| Surface neutrals (`surface-*`) | `web/tailwind.config.js:43-56` | Gray scale (convention-neutral, can stay) |
| Display font | `web/tailwind.config.js:11` | Nunito (must change to M PLUS 1) |
| Body font | `web/tailwind.config.js:12` | Source Sans 3 (must change to Lato) |
| Logo | `web/public/ab-logo.jpg` | Anime Boston logo |
| Hero image | `web/public/ab-koinobori.jpg` | AB Koinobori poster |
| Favicon | `web/public/favicon.svg` | AB-colored circle |
| Demo title | `docs/index.html:5` | "GR-Ops Demo — Anime Boston 2026" |
| CSS custom properties | `docs/index.html` inline | Same `ab-*` and `accent-*` scales |

**Acceptance Criteria:**
- [ ] Zero convention-specific branding in source code after migration
- [ ] All branding assets loaded from config or environment

---

### 2. Theme Data Model

**Purpose:** Define where branding lives in the database.

**`platform_config` table** (or a dedicated `theme_config` record):

```sql
-- Theme config stored as a single JSONB record in platform_config
-- Key: 'theme'
{
  "orgName": "Anime Boston",
  "orgShortName": "AB",
  "conventionName": "Anime Boston 2026",
  "logoUrl": "/assets/logo.png",
  "faviconUrl": "/assets/favicon.svg",
  "heroImageUrl": "/assets/hero.jpg",
  
  "colors": {
    "primary": {
      "50": "#F0F5FA", "100": "#D6EDF7", "200": "#B8DFF0",
      "300": "#9BD0EC", "400": "#7ABDE3", "500": "#5BA8D9",
      "600": "#4A90C4", "700": "#3A7DB5", "800": "#2D6A9F",
      "900": "#234B72", "950": "#1A3A5C"
    },
    "accent": {
      "50": "#FFF8ED", "100": "#FFEFD4", "200": "#FFD9A0",
      "300": "#F0AC40", "400": "#E8962D", "500": "#D4820F",
      "600": "#B86D08", "700": "#9A5A06", "800": "#7C4805",
      "900": "#5E3604"
    }
  },
  
  "fonts": {
    "display": "M PLUS 1",
    "displayWeight": "900",
    "body": "Lato"
  },
  
  "meta": {
    "pageTitle": "GR-Ops — Anime Boston",
    "description": "Convention operations platform"
  }
}
```

**Alternative: environment variables** for deploy-time config (simpler, no DB dependency at build):

```env
VITE_ORG_NAME="Anime Boston"
VITE_PRIMARY_600="#4A90C4"
VITE_ACCENT_400="#E8962D"
VITE_FONT_DISPLAY="M PLUS 1"
VITE_FONT_BODY="Lato"
VITE_LOGO_URL="/assets/logo.png"
```

**Recommended approach:** Both. Environment variables for build-time Tailwind config (colors compiled into CSS). Database config for runtime values (org name, logo URL, page title) that the Vue app reads at startup.

**Acceptance Criteria:**
- [ ] Theme colors configurable without modifying source
- [ ] Org name and logo changeable at runtime via settings UI
- [ ] New deployment can set branding before first user sees the app

---

### 3. Tailwind Theme Generation

**Purpose:** Define how Tailwind consumes theme config.

**Current:** Colors hardcoded in `tailwind.config.js`.

**Target:** Tailwind reads from environment variables at build time:

```js
// web/tailwind.config.js
function colorScale(prefix, fallback) {
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
  return Object.fromEntries(
    steps.map(step => [
      step,
      process.env[`VITE_${prefix}_${step}`] || fallback[step]
    ])
  )
}

const DEFAULT_PRIMARY = {
  50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD',
  400: '#60A5FA', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8',
  800: '#1E40AF', 900: '#1E3A8A', 950: '#172554'
}

const DEFAULT_ACCENT = {
  50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
  400: '#FBBF24', 500: '#F59E0B', 600: '#D97706', 700: '#B45309',
  800: '#92400E', 900: '#78350F'
}

export default {
  theme: {
    extend: {
      colors: {
        primary: colorScale('PRIMARY', DEFAULT_PRIMARY),
        accent: colorScale('ACCENT', DEFAULT_ACCENT),
        // surface stays neutral — convention-independent
        surface: { /* ... unchanged ... */ }
      },
      fontFamily: {
        display: [process.env.VITE_FONT_DISPLAY || 'M PLUS 1', 'system-ui', 'sans-serif'],
        sans: [process.env.VITE_FONT_BODY || 'Lato', 'system-ui', 'sans-serif'],
      }
    }
  }
}
```

**Key change:** `ab-*` token names → `primary-*`. Convention-neutral naming. The actual colors come from env vars or defaults.

**Acceptance Criteria:**
- [ ] `ab-*` renamed to `primary-*` throughout codebase
- [ ] Default theme is neutral (blue/amber, not AB-specific)
- [ ] Environment variables override defaults at build time
- [ ] No AB-specific color values in source code

---

### 4. Runtime Branding

**Purpose:** Define how the Vue app loads branding at runtime.

**Detail:**

The Vue app loads theme config from the API at startup:

```typescript
// web/src/stores/app.ts (or dedicated theme store)
async function loadTheme() {
  const config = await api.get('/api/config/theme')
  document.title = config.meta.pageTitle
  // Set CSS custom properties for runtime values
  document.documentElement.style.setProperty('--logo-url', `url(${config.logoUrl})`)
  // Store for component access
  theme.value = config
}
```

**What's build-time vs runtime:**

| Aspect | Build-Time (Tailwind/env) | Runtime (API/DB) |
|---|---|---|
| Color palette | Yes (compiled into CSS utilities) | No (would need CSS-in-JS) |
| Font family | Yes (in Tailwind config) | Font loading URL can be runtime |
| Logo URL | No | Yes (displayed via `<img :src="theme.logoUrl">`) |
| Org name | No | Yes (displayed in header, footer, emails) |
| Convention name | No | Yes (displayed in titles, contracts) |
| Favicon | Build-time (static file) | Could be runtime via `<link>` injection |
| Page title | No | Yes (document.title at startup) |

**Acceptance Criteria:**
- [ ] Logo, org name, convention name load from DB config
- [ ] Page title set at startup from config
- [ ] Changing logo in settings UI updates immediately (no redeploy)

---

### 5. Asset Management

**Purpose:** Define how logos and images are stored.

**Detail:**

- **Logo/favicon/hero:** Uploaded via settings UI → stored in Cloud Storage bucket `branding/` → URL stored in platform_config
- **Default assets:** Engine ships with a generic placeholder logo (simple geometric mark, no convention branding)
- **Convention assets:** Uploaded at deploy time or via settings. AB's logo, koinobori, favicon are NOT in the repo — they're in AB's Cloud Storage bucket
- **Email templates:** Reference `{{convention.logoUrl}}` from platform_config, not hardcoded paths

**Acceptance Criteria:**
- [ ] No convention-specific images in the repo
- [ ] Generic placeholder logo in source for fresh deployments
- [ ] Convention uploads their own assets via settings

---

### 6. Token Rename Migration

**Purpose:** Define the codebase changes to remove AB-specific naming.

**Detail:**

| Current | New | Files Affected |
|---|---|---|
| `ab-50` through `ab-950` | `primary-50` through `primary-950` | All `.vue` files, `tailwind.config.js`, `global.css` |
| `ab-logo.jpg`, `ab-koinobori.jpg` | Removed from repo, loaded from config | `web/public/`, `docs/` |
| `--ab-ink`, `--ab-deep`, etc. | `--primary-ink`, `--primary-deep` or just use Tailwind tokens | `global.css`, demo HTML |
| Font: Nunito + Source Sans 3 | Configurable, default: M PLUS 1 (display, Black/900 weight) + Lato (body). Japanese-inspired display font for convention aesthetic. | `tailwind.config.js`, Google Fonts link |
| "Anime Boston" in titles | `{{convention.name}}` from config | Component templates, page titles |

**This is a find-and-replace + config extraction.** No architectural changes — just moving hardcoded values to config.

**Acceptance Criteria:**
- [ ] `grep -r "ab-" web/src/` returns zero results (excluding comments about the migration)
- [ ] `grep -r "Anime Boston" web/src/` returns zero results
- [ ] Default theme renders clean neutral design
- [ ] AB theme applied via env vars produces identical output to current

---

### 7. Dual-Theme System

**Purpose:** Define the OSS-neutral default theme and the AB convention override.

**Detail:**

The platform ships with two theme modes:

| Theme | Class | Colors | Fonts | When Active |
|-------|-------|--------|-------|-------------|
| **OSS Default** | (no class) | Refined minimal — neutral blue/slate primary, warm gray accent | M PLUS 1 (display), Lato (body) | Fresh deployment, no convention config |
| **AB Override** | `.theme-ab` | Blue (`#4A90C4` primary) + amber/orange (`#E8962D` accent) from AB poster palette | Same fonts, both themes | When `platform_config.theme.convention = 'anime-boston'` |

**Token naming:** All tokens use `primary-*` and `accent-*`, never `ab-*`. The AB theme overrides the token values, not the token names. This keeps the source code convention-neutral.

**Application:** The `<html>` element receives the `.theme-ab` class at runtime when the convention is identified. Tailwind utilities reference `primary-*` / `accent-*` tokens which resolve to different values per theme.

**Acceptance Criteria:**
- [ ] Default theme renders a refined, neutral design suitable for any convention
- [ ] AB theme applied via `.theme-ab` class produces the blue/amber palette
- [ ] Token names are `primary-*` and `accent-*` everywhere — zero `ab-*` tokens
- [ ] Theme switching is runtime (class toggle), not a rebuild

---

### 8. Settings UI

**Purpose:** Define how admins change branding.

**Detail:**

Settings page → Branding section:
- **Organization name:** text input
- **Convention name:** text input (e.g., "Anime Boston 2026")
- **Logo:** file upload (stored in Cloud Storage, URL saved to config)
- **Favicon:** file upload
- **Primary color:** color picker or hex input for the 600-level (auto-generate full scale using color math)
- **Accent color:** same
- **Display font:** dropdown of Google Fonts or custom URL
- **Body font:** same

**Color scale generation:** Given a single primary color (e.g., #4A90C4), generate the full 50-950 scale programmatically using HSL lightness adjustments. Libraries like `chroma-js` or `colorjs.io` handle this. Admin picks one color, system generates the whole palette.

**Acceptance Criteria:**
- [ ] Admin can change all branding values via settings UI
- [ ] Color picker generates full scale from single input
- [ ] Changes take effect immediately (no redeploy for runtime values)
- [ ] Build-time values (Tailwind colors) require a rebuild to take effect — documented in UI

---

### 9. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Token rename | Static analysis | `grep -r "ab-" web/src/` | Zero matches |
| AB string removal | Static analysis | `grep -r "Anime Boston" web/src/` | Zero matches |
| Default theme | Visual | Fresh deploy with no env vars | Neutral design renders |
| Custom theme | Visual | Set AB colors via env vars | Identical to current design |
| Runtime branding | Integration | Change logo in settings → UI updates | New logo visible without redeploy |
| Color generation | Unit | Input #4A90C4 → full 11-step scale | Scale matches expected values |
| Settings UI | E2E | Admin changes org name + logo + color | All reflected in app |
| Asset upload | Integration | Upload logo → Cloud Storage → URL in config | Logo accessible |

**Coverage target:** 100% on token rename (static analysis). 80% on color generation and settings CRUD.
