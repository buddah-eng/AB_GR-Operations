# Org Admin Dashboard

> The shared services team's control center. Cross-department view of all departments, their setup
> status, and active users. Template management. User management. Org-wide settings. Audit overview.
> Health metrics. This is the admin's home page -- different from any department's dashboard.

---

## Overview

The org admin dashboard is the home page for users with the `admin` role. While department directors have their own department dashboards (scoped to their department's data), the admin needs a cross-cutting view of the entire organization: which departments exist and what state they are in, who has access, what templates are available, what settings apply org-wide, and what has changed recently across all departments.

This dashboard is NOT a hardcoded Vue page. It is rendered from a PageConfig stored in Postgres, following the platform thesis that the source code is the engine and the database is the application. The dashboard widgets query real data via the same API endpoints that all other views use.

The admin dashboard is accessed at `/admin` and is only visible to users with the `admin` role. It replaces the setup wizard as the admin's primary interface after D0 setup is complete.

**What this PRD covers:** The admin dashboard page layout, widgets, navigation sections (departments, templates, users, settings, audit, health), and the admin-specific workflows they enable.

**What this PRD does NOT cover:** The D0 setup wizard (that's `platform/shared-services-setup.md`). Individual department dashboards (that's `core/department-as-concept.md`). Template infrastructure (that's `platform/template-infrastructure.md`).

**Dependencies:**
- `core/department-as-concept.md` -- department data displayed in dashboard
- `core/rbac-engine.md` -- admin role gating
- `core/audit-system.md` -- audit data for overview
- `shared-services/staff-management.md` -- user/staff data
- `platform/template-infrastructure.md` -- template management
- `platform/template-library.md` -- template browsing
- `platform/shared-services-setup.md` -- post-setup entry point
- `platform/branding.md` -- dashboard follows org branding
- `ui/view-renderer.md` -- dashboard widget rendering
- `ui/dynamic-forms.md` -- settings form rendering
- `data-infrastructure/notifications.md` -- notification settings

---

## Full Specification

### 1. Dashboard Home

**Purpose:** The admin's landing page showing a cross-department overview of the organization.

**Detail:**

The dashboard home is a PageConfig-driven widget layout at `/admin`:

**Default widget layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  [Org Name] Admin Dashboard                                 │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│ Departments │ Active Users│ Total       │ Pending           │
│     6       │     23      │ Records     │ Invitations       │
│             │             │   1,247     │      4            │
├─────────────┴─────────────┴─────────────┴───────────────────┤
│                                                             │
│  Department Status                                          │
│  ┌──────────────────┬────────┬────────┬─────────┬────────┐  │
│  │ Department       │ Status │ Staff  │ Records │ Setup  │  │
│  ├──────────────────┼────────┼────────┼─────────┼────────┤  │
│  │ Guest Relations  │ Active │   8    │   156   │  100%  │  │
│  │ Programming      │ Active │   5    │   342   │  100%  │  │
│  │ Operations       │ Active │  12    │    89   │  100%  │  │
│  │ Vendor Relations │ Setup  │   2    │    23   │   60%  │  │
│  │ Registration     │ Active │   3    │   637   │  100%  │  │
│  │ A/V & Tech       │ Inact. │   1    │     0   │   25%  │  │
│  └──────────────────┴────────┴────────┴─────────┴────────┘  │
│                                                             │
│  Recent Activity                                            │
│  • [2m ago] Sarah Chen updated guest "Tanaka Yuki" status   │
│  • [15m ago] Mike Brown created 3 new schedule events       │
│  • [1h ago] Admin invited 4 users to Operations             │
│  • [2h ago] Lisa Park modified GR prep checklist template   │
│                                                             │
│  Quick Actions                                              │
│  [+ Add Department]  [+ Invite Users]  [Browse Templates]   │
└─────────────────────────────────────────────────────────────┘
```

**Widgets (all config-driven via PageConfig):**

| Widget | Type | Data Source | Refresh |
|--------|------|------------|---------|
| Department Count | `stat_card` | `SELECT count(*) FROM departments WHERE status IN ('active', 'setup_in_progress')` | Real-time via SSE |
| Active Users | `stat_card` | `SELECT count(*) FROM staff WHERE status = 'active'` | Real-time via SSE |
| Total Records | `stat_card` | Aggregate across concept tables: `SELECT (SELECT count(*) FROM guests) + (SELECT count(*) FROM staff) + (SELECT count(*) FROM schedule_events) + (SELECT count(*) FROM prep_items) + (SELECT count(*) FROM pairings) + (SELECT count(*) FROM venues) + (SELECT count(*) FROM transport_bookings) AS total` | 5-minute cache |
| Pending Invitations | `stat_card` | `SELECT count(*) FROM staff WHERE status = 'pending'` | Real-time via SSE |
| Department Status Table | `data_table` | `departments` join `staff` for counts | Real-time via SSE |
| Recent Activity | `activity_feed` | Audit log, last 20 entries, cross-department | Real-time via SSE |
| Quick Actions | `action_bar` | Static links to admin actions | N/A |

**Setup completion %:** A department's setup completion is calculated from:
- Has director assigned (20%)
- Has at least 3 active concepts (20%)
- Has at least 1 form config (20%)
- Has at least 1 view config (20%)
- Director has logged in at least once (20%)

**Acceptance Criteria:**
- [ ] Admin dashboard renders from PageConfig (not hardcoded Vue)
- [ ] Stat cards show accurate real-time counts
- [ ] Department status table shows all departments with setup completion %
- [ ] Recent activity feed shows cross-department audit entries
- [ ] Quick action buttons navigate to the correct admin pages
- [ ] Dashboard is only accessible to admin role

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| DASH-01 | Integration | Admin loads dashboard | All widgets render with correct data |
| DASH-02 | Integration | New staff record created | Active Users stat updates in real-time |
| DASH-03 | Integration | Department status change | Department status table updates |
| DASH-04 | Integration | Non-admin accesses /admin | 403 Forbidden |
| DASH-05 | Integration | Setup completion calculation | Correct % for partially-setup department |

---

### 2. Department Management Section

**Purpose:** Admin view for managing all departments -- create, configure, activate, deactivate.

**Detail:**

Accessed at `/admin/departments`, this section provides:

**Department list view:**
- Table showing all departments (including inactive and archived)
- Columns: name, key, status, director, member count, concept count, record count, created date
- Filters: status, director assigned (yes/no), template source
- Sort: by name, status, member count, created date

**Department actions:**
- **Create:** Opens the department creation flow (template selection from `platform/template-library.md` or blank creation)
- **Edit:** Opens department settings page (`core/department-as-concept.md` section 6)
- **Change Status:** Dropdown to change status (active/inactive/archived) with confirmation dialog
- **Assign Director:** Staff picker to assign or change the department's director
- **View on Canvas:** Opens the system graph centered on this department
- **Export Config:** Exports the department's ontology, forms, views, and workflows as a template pack

**Bulk actions:**
- Activate/deactivate multiple departments
- Assign roles across departments (e.g., assign a user as coordinator in 3 departments)

**Acceptance Criteria:**
- [ ] Department list shows all departments with all specified columns
- [ ] Create flow integrates with template library
- [ ] Status changes follow the lifecycle state machine (`core/department-as-concept.md` section 2)
- [ ] Director assignment updates department and staff records
- [ ] Export creates a valid template pack
- [ ] Bulk actions work for multi-department operations

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| DEPT-01 | Integration | List all departments | All departments shown with correct counts |
| DEPT-02 | Integration | Create department from template | Department created with template content |
| DEPT-03 | Integration | Change department status to inactive | Status updated, writes to department rejected |
| DEPT-04 | Integration | Assign new director | director_id updated, new director gains access |
| DEPT-05 | Integration | Export department config | Valid template pack JSON generated |

---

### 3. User Management Section

**Purpose:** Admin view for managing all users -- invite, assign roles, manage access.

**Detail:**

Accessed at `/admin/users`, this section provides:

**User list view:**
- Table showing all staff records
- Columns: name, email, role(s), department, status, last active, invited date
- Filters: role, department, status (active/pending/inactive)
- Search: by name or email

**User actions:**
- **Invite:** Email invitation flow (same as setup wizard step 4, see `platform/shared-services-setup.md` section 5)
- **Edit Roles:** Change role assignment(s) for a user
- **Change Department:** Move a user to a different department
- **Deactivate:** Set user status to inactive (preserves data, removes access)
- **Reactivate:** Restore an inactive user
- **View Activity:** Show audit log filtered to this user's actions
- **Resend Invitation:** Regenerate and resend invitation link for pending users

**Bulk invitation:**
- CSV upload for batch invitations (same as setup wizard)
- Multi-select users for bulk role changes

**Role management sub-section:**
- View all defined roles with their priority and permission summary
- Add, edit, delete roles (same UI as setup wizard step 3)
- View which users hold each role

**Acceptance Criteria:**
- [ ] User list shows all staff with role, department, and status
- [ ] Invitation flow creates pending staff records and sends emails
- [ ] Role changes update permissions immediately (cache refresh)
- [ ] Deactivation preserves data but revokes access
- [ ] Activity view shows the user's audit trail
- [ ] Bulk CSV import works for 100+ users

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| USER-01 | Integration | Invite new user | Staff record created, email sent |
| USER-02 | Integration | Change user's role | Permissions updated after cache refresh |
| USER-03 | Integration | Deactivate user | User cannot log in, data preserved |
| USER-04 | Integration | Search users by email | Correct user returned |
| USER-05 | Integration | View user activity | Audit log entries shown for that user |
| USER-06 | Integration | Bulk invite via CSV | All records created, emails sent |

---

### 4. Template Management Section

**Purpose:** Admin interface for creating, editing, and publishing templates for departments to use.

**Detail:**

Accessed at `/admin/templates`, this section provides:

**Template list view:**
- All templates organized by category (department packs, forms, views, workflows, prep)
- Shows: name, category, version, last modified, usage count (how many departments applied it)
- Filters: category, template_type, status (active/archived)

**Template actions:**
- **Browse Library:** Opens the template library (`platform/template-library.md`)
- **Create New:** Template creation wizard:
  1. Select template type (department pack, form, view, workflow, prep)
  2. For department packs: select concepts, configure properties, set up forms/views/workflows
  3. For individual templates: configure the specific template content
  4. Preview the template
  5. Publish (sets status to active)
- **Edit:** Modify existing template content (creates new version per `platform/template-library.md` section 5)
- **Deprecate:** Archive a template version
- **Export:** Export template as JSON (`platform/template-infrastructure.md` section 5)
- **Import:** Import template from JSON file

**Template from existing department:**
The admin can create a new template pack from an existing department's configuration:
1. Select department
2. Choose which components to include (concepts, forms, views, workflows)
3. The system creates a template pack with generalized keys (department-specific keys → template placeholders)
4. Admin reviews, names, and publishes the template

This enables the "learn from what works" pattern: a well-configured department becomes a template for future departments or conventions.

**Acceptance Criteria:**
- [ ] Template list shows all templates with version and usage count
- [ ] Template creation wizard produces valid template records
- [ ] Edit creates new version (forward-only versioning)
- [ ] Export produces a self-contained JSON file
- [ ] Import creates template records from JSON
- [ ] "Create from existing department" generalizes keys and produces a valid template

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| TPL-01 | Integration | List templates | All templates shown with correct metadata |
| TPL-02 | Integration | Create new form template | Template record created with valid content |
| TPL-03 | Integration | Edit template → new version | Version incremented, old version archived |
| TPL-04 | Integration | Export template as JSON | Valid JSON file with all components |
| TPL-05 | Integration | Import template from JSON | Template records created in database |
| TPL-06 | Integration | Create template from GR department | Template pack with generalized keys created |

---

### 5. Org-Wide Settings Section

**Purpose:** Admin interface for managing organization-level configuration.

**Detail:**

Accessed at `/admin/settings`, this section provides all settings from the D0 setup wizard (`platform/shared-services-setup.md` section 6) plus additional settings:

**Sub-sections:**

| Sub-section | Settings | Notes |
|-------------|----------|-------|
| Organization | Convention name, year, dates, venues, timezone | From setup step 1 |
| Branding | Logo, colors, fonts | Integrated with `platform/branding.md` |
| Communication | Notification channels, email sender, digest mode | From setup step 5 |
| Security | Session timeout, API key expiration, invitation expiration | From setup step 5 |
| Data | YoY registry, backup schedule, retention policy | From setup step 5 |
| Integrations | Google Calendar service account, Guidebook API key, FlightAware credentials | API keys for external integrations |
| API | API key management, webhook subscriptions, rate limits | From `api/integration-patterns.md` |

**Settings form rendering:** Each sub-section renders from a FormConfig. Settings changes go through the full write pipeline (validation, audit, events).

**Settings change notification:** When an org-wide setting changes, a `organization.settings_changed` domain event is emitted. Downstream handlers (notification service, branding engine, etc.) react accordingly.

**Acceptance Criteria:**
- [ ] All org-wide settings are accessible from `/admin/settings`
- [ ] Settings forms render from FormConfig
- [ ] Settings changes are audited
- [ ] Settings changes emit domain events
- [ ] Branding changes are reflected immediately
- [ ] Only admin can access settings

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SET-01 | Integration | Update convention dates | organization.settings updated, event emitted |
| SET-02 | Integration | Change branding colors | UI reflects new colors immediately |
| SET-03 | Integration | Add Google Calendar service account key | Key stored securely, calendar sync enabled |
| SET-04 | Integration | Non-admin accesses /admin/settings | 403 Forbidden |

---

### 6. Audit Overview Section

**Purpose:** Cross-department audit trail for the admin to see who changed what across the entire organization.

**Detail:**

Accessed at `/admin/audit`, this section provides:

**Audit feed:**
- Chronological list of all audit entries across all departments
- Each entry shows: timestamp, actor (name + avatar), action (created/updated/deleted), target (concept + record), department, change summary
- Expandable detail: click an entry to see the full diff (old values vs new values)

**Filters:**
- Date range
- Department
- Actor (user)
- Action type (create/update/delete)
- Concept (e.g., filter to only guest-related changes)
- Source (builder/canvas/API/workflow)

**Search:**
- Full-text search across audit entries
- Search by record name or value

**Aggregations:**
- Changes per department (bar chart)
- Changes per user (leaderboard)
- Changes by time of day (heatmap)
- Most-modified concepts (ranked list)

**Export:**
- Export filtered audit log as CSV
- Export with or without diffs

**Acceptance Criteria:**
- [ ] Audit feed shows all cross-department changes
- [ ] Filters narrow results by department, user, action, concept, source
- [ ] Expandable detail shows old/new value diffs
- [ ] Aggregation charts render accurate data
- [ ] CSV export includes all filtered entries
- [ ] Only admin can access the audit overview

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| AUD-01 | Integration | Load audit feed | Recent entries across all departments shown |
| AUD-02 | Integration | Filter by department "Guest Relations" | Only GR audit entries shown |
| AUD-03 | Integration | Filter by source "canvas" | Only canvas-originated changes shown |
| AUD-04 | Integration | Expand an entry | Full diff shown with old and new values |
| AUD-05 | Integration | Export as CSV | Valid CSV with all filtered entries |
| AUD-06 | Integration | Changes per department chart | Accurate bar chart rendered |

---

### 7. Health Metrics Section

**Purpose:** Show which departments are fully operational and which have gaps.

**Detail:**

Accessed at `/admin/health`, this section provides:

**Department health cards:**
Each department gets a health card showing:

```
┌─────────────────────────────────────┐
│  Guest Relations                    │
│  Status: Active    Health: 92%      │
│                                     │
│  ✅ Director assigned               │
│  ✅ 8 concepts defined              │
│  ✅ 5 forms configured              │
│  ✅ 5 views configured              │
│  ✅ 4 workflows active              │
│  ⚠️  2 concepts have no form config │
│  ✅ 156 records                     │
│  ✅ All staff active                │
└─────────────────────────────────────┘
```

**Health score calculation:**

| Criterion | Weight | Green | Yellow | Red |
|-----------|--------|-------|--------|-----|
| Director assigned | 15% | Yes | — | No |
| Concepts defined | 10% | 3+ | 1-2 | 0 |
| All concepts have forms | 15% | 100% | 50-99% | <50% |
| All concepts have views | 15% | 100% | 50-99% | <50% |
| Workflows configured | 10% | 2+ | 1 | 0 |
| Active staff members | 10% | 3+ | 1-2 | 0 |
| Records created | 10% | 10+ | 1-9 | 0 |
| Recent activity (last 7 days) | 15% | Yes | — | No |

**Organization-level health:**
- Overall health score (weighted average of department health scores)
- Number of departments at each health level (green/yellow/red)
- List of actionable gaps: "A/V & Tech has no director. Vendor Relations has 2 concepts without forms."

**Health alerts:**
- Departments that drop below 50% health trigger an in-app notification to the admin
- Weekly health digest email (if configured) summarizes org health

**Acceptance Criteria:**
- [ ] Each department has a health card with itemized criteria
- [ ] Health score is calculated from the weighted criteria
- [ ] Organization-level health aggregates department scores
- [ ] Actionable gaps are listed with specific recommendations
- [ ] Health alerts trigger for departments below 50%
- [ ] Health data refreshes on page load (no cache for health metrics)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| HEALTH-01 | Integration | Fully configured department | 100% health score, all green |
| HEALTH-02 | Integration | Department with no director | Score reduced, "No director" flagged red |
| HEALTH-03 | Integration | Department with 1 of 5 concepts having no form | Score reduced, gap listed |
| HEALTH-04 | Integration | Department below 50% | Alert notification generated |
| HEALTH-05 | Integration | Org-level health with 3 green, 2 yellow, 1 red | Correct aggregate and breakdown |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `core/department-as-concept.md` | Department data displayed in dashboard |
| `core/rbac-engine.md` | Admin role gating for all sections |
| `core/audit-system.md` | Audit data for overview section |
| `shared-services/staff-management.md` | User data for management section |
| `platform/template-infrastructure.md` | Template CRUD for management section |
| `platform/template-library.md` | Template browsing embedded in template section |
| `platform/shared-services-setup.md` | Dashboard is the post-setup entry point |
| `platform/branding.md` | Dashboard follows org branding |
| `ui/view-renderer.md` | Dashboard widget rendering (stat cards, tables, charts) |
| `ui/dynamic-forms.md` | Settings form rendering |
| `data-infrastructure/notifications.md` | Health alerts and invitation emails |
| `data-infrastructure/real-time.md` | SSE for live-updating widgets |
| `canvas/system-graph.md` | "View on Canvas" links to system graph |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| PageConfig-driven dashboard, not hardcoded | Consistent with platform thesis. Admin dashboard is config, not code. Allows customization of widget layout. |
| Separate from department dashboards | Admin needs a cross-cutting view. Department dashboards are scoped. Mixing them would either limit the admin view or overwhelm department leaders with org-wide data. |
| Health score with weighted criteria | A single score gives at-a-glance status. Weighted criteria reflect what matters most (director assigned, forms configured) vs what is nice-to-have (recent activity). |
| Audit overview with aggregation charts | Raw audit logs are useful for investigation. Aggregation charts are useful for spotting patterns (which department is most active? who is making the most changes? when do changes happen?). |
| Template "create from department" feature | Bridges the gap between building and sharing. A director who builds a great department can have their work packaged as a template for others, encouraging knowledge sharing. |
| Settings emit domain events | Org-wide settings affect multiple subsystems (branding, notifications, scheduling). Domain events ensure all subsystems react to changes without tight coupling. |
