# Wiring Audit

> Every exported function must have a caller. Every database column must have code that reads and writes it.
> Every table must have queries that use it. No dead code, no orphan columns, no unconnected building blocks.
> Run after every PRD implementation, before declaring it complete.

---

## Overview

The most common failure mode in this project is building blocks that exist in isolation — a function is implemented and tested with mocks but never called from the actual application path. A database column is created in a migration but no code populates it. A module is exported but never imported.

This PRD defines a mandatory verification step that catches these disconnects before a phase is declared complete.

---

## 1. Dead Export Scan

**Purpose:** Find exported functions/classes/constants that nothing imports.

**Procedure:**

For every `.ts` file modified in the current phase:

1. List all `export` declarations (functions, classes, constants, types)
2. For each export, grep the codebase for imports of that name
3. Exceptions: types/interfaces used only by consumers in other packages (frontend), test helpers, and `index.ts` re-exports
4. Any export with zero imports outside its own file and test file is a **wiring failure**

**Automated check:**
```bash
# For each exported symbol, verify it's imported somewhere
grep -r "export function\|export class\|export const\|export async function" src/ \
  --include="*.ts" --exclude="*.test.ts" -h \
  | sed 's/export \(async \)\?function //' | sed 's/export const //' | sed 's/export class //' \
  | cut -d'(' -f1 | cut -d' ' -f1 | cut -d':' -f1 \
  | while read sym; do
      count=$(grep -r "$sym" src/ --include="*.ts" -l | wc -l)
      if [ "$count" -le 2 ]; then  # only in definition file + maybe test
        echo "ORPHAN: $sym (found in $count files)"
      fi
    done
```

**Acceptance Criteria:**
- [ ] Zero orphan exports in phase code (excluding types and test helpers)
- [ ] Scan runs as part of phase completion checklist
- [ ] Any orphan triggers investigation: is it dead code (delete it) or unwired (wire it)

---

## 2. Column Population Audit

**Purpose:** Every database column created in a migration must have application code that writes to it and reads from it.

**Procedure:**

For every migration file in the current phase:

1. List all columns created (from `CREATE TABLE` and `ALTER TABLE ADD COLUMN`)
2. For each column, grep application code (not tests, not migrations) for the column name
3. Columns only in migrations but not in any `.ts` file are **orphan columns**
4. Columns read but never written (or vice versa) are **partial wiring**

**Exceptions:**
- Columns with `DEFAULT` values that are auto-populated (e.g., `created_at DEFAULT now()`)
- Columns populated by triggers (e.g., audit log columns populated by `audit_ontology_trigger`)
- System columns (`id` with `gen_random_uuid()`)

**Automated check:**
```bash
# Extract column names from migrations, check if they appear in .ts source
grep -oP '^\s+(\w+)\s+(UUID|TEXT|INTEGER|BOOLEAN|JSONB|TIMESTAMPTZ|INET|DATE)' \
  src/db/migrations/*.sql \
  | awk '{print $1}' | sort -u \
  | while read col; do
      ts_count=$(grep -r "$col" src/ --include="*.ts" --exclude="*.test.ts" --exclude="*.sql" -l | wc -l)
      if [ "$ts_count" -eq 0 ]; then
        echo "ORPHAN COLUMN: $col (0 .ts references)"
      fi
    done
```

**Acceptance Criteria:**
- [ ] Every non-auto column has at least one write path and one read path in application code
- [ ] Audit runs after every migration change

---

## 3. Import Chain Verification

**Purpose:** When PRD A says "uses feature from PRD B," verify the actual import and function call exist.

**Procedure:**

For each PRD in the current phase:

1. Read the PRD's "Dependencies" and "Detail" sections
2. List every cross-module reference (e.g., "calls `evaluateCondition` from condition-expression")
3. Grep for the actual import statement in the implementing file
4. Grep for the actual function call (not just import — must be called)
5. Missing import or call is a **broken dependency**

**Example failures this catches:**
- PRD says "domain CRUD calls `withAuditContext`" → grep shows `withAuditContext` imported but only called in create/update, not delete
- PRD says "event_log includes change_set" → column exists but `logEventToPostgres()` never populates it
- PRD says "write-time validation via `validateCondition`" → function exists but no write path calls it

**Acceptance Criteria:**
- [ ] Every cross-module dependency stated in the PRD has a corresponding import + call in source code
- [ ] Verification documented: for each dependency, cite the file and line where the call occurs

---

## 4. Test Coverage Reality Check

**Purpose:** Verify that tests actually exercise the wired paths, not just isolated units.

**Procedure:**

1. Run unit tests — all must pass
2. For each wired integration point (from §3), verify there's a test that exercises it:
   - If function A calls function B, there should be a test where A's mock of B is verified to have been called
   - OR an integration test where A and B run together against real infrastructure
3. Any wired path without a test is a **coverage gap**

**Specifically check:**
- Every API endpoint test verifies the audit context is created and passed through
- Every write-path test verifies domain events are emitted
- Every encryption integration test verifies RBAC filtering happens before decryption
- Every test that mocks a dependency verifies the mock was actually called (not just set up)

**Acceptance Criteria:**
- [ ] Every wired integration point has at least one test exercising it
- [ ] No mock is set up without an assertion that it was called
- [ ] Integration tests cover the full pipeline, not just individual steps

---

## 5. Execution

**When:** After every PRD implementation, before declaring the phase complete.

**Who:** The implementing agent runs all four checks.

**Output:** A wiring audit report with:
- Orphan exports (§1)
- Orphan columns (§2)
- Broken dependencies (§3)
- Coverage gaps (§4)

**Gate:** Phase cannot be declared complete if any check fails. Failures must be fixed and the audit re-run.

**Memory:** Save the audit results to project memory for reference in future phases.
