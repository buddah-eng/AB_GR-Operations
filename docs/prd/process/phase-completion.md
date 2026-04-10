# Phase Completion Protocol

> A phase is complete when a full verification cycle finds ZERO issues. Not when the code exists.
> Not when tests pass. Not when it "looks done." When an iterative, multi-pass audit converges
> to zero findings. Every pass is documented. Every fix triggers a re-run. Shortcuts are visible
> because every step produces auditable output. The protocol runs autonomously, discovers issues
> cold, and proves its own correctness without human pre-seeding or mid-cycle approval.

---

## Overview

The most dangerous moment in this project is when someone says "Phase N is complete." Every previous declaration of completion was wrong — the code existed but wasn't wired, tests passed but didn't cover the acceptance criteria, modules were implemented but not connected.

This protocol makes it structurally difficult to shortcut. Each step produces concrete, verifiable output. Skipping a step is visible because the output is missing. Finding an issue resets the cycle, because fixes can introduce new issues.

**The protocol is iterative.** It runs in cycles until a complete cycle finds zero issues. There is no fixed number of passes — you keep going until clean.

---

## Protocol Independence (R28)

> The verifier must discover failures cold. Never pre-seed it with known issues. If it can't find
> the problems on its own, the protocol is broken — not the verifier.

### Purpose

The completion protocol must work for an agent with NO prior session context. It proves its value by discovering issues through its own scanning steps, not by being told what to look for. Pre-seeding the verifier with known failures defeats the entire purpose — it turns a verification protocol into a confirmation protocol.

### Rules

1. **No pre-seeding.** The executing agent must NOT be told about known failures, prior cycle findings, or suspected issues before running the protocol. It starts cold.
2. **Self-discovering.** Every issue must be found through the protocol's own steps (automated scans, pipeline checks, acceptance audits, fresh-eyes read, build/test output, behavioral verification). If a step can't surface a category of issue, add a step that can.
3. **No hints in the prompt.** When initiating the protocol, the caller provides only: which phase to verify and where the PRDs live. Nothing about what's broken, what was recently fixed, or what to pay attention to.
4. **Proof of independence.** If the protocol consistently misses issues that were known beforehand, the protocol itself is deficient and must be strengthened — not worked around by feeding it answers.

### Acceptance Criteria

- [ ] Protocol can be initiated with only "verify Phase N" — no additional context required
- [ ] Agent discovers all issues through Steps 0-6, not from prior knowledge
- [ ] No session history, known-failure lists, or hints are passed to the verifier
- [ ] Protocol deficiencies are fixed by adding/improving steps, not by pre-seeding

---

## Autonomy (R29)

> Once you say "run the completion protocol," the agent cycles until convergence. No stopping
> for thumbs-up. No "shall I continue?" The approval was the initiation.

### Purpose

The completion protocol runs as an autonomous loop. Once initiated, the agent cycles through Steps 0-6, fixes findings, and restarts — without stopping for human approval between cycles. The act of initiating the protocol IS the approval. Mid-cycle interruptions break flow, introduce bias ("just skip that one"), and waste time.

### Rules

1. **No mid-cycle approval gates.** The agent does not pause to ask "should I fix this?" or "should I continue?" It fixes and re-runs.
2. **Stop conditions are mechanical**, not social:
   - **STOP: Zero findings** — a complete cycle (Steps 0-6) with zero issues across all steps. Phase is complete.
   - **STOP: Ambiguous design decision** — a finding that requires domain judgment the agent cannot make (e.g., "should this field be nullable?" when the PRD doesn't specify). Document the ambiguity, stop, and surface it.
   - **STOP: Infinite loop detection** — the same finding appearing in 3+ consecutive cycles with the same fix attempted. Something structural is wrong; surface it.
3. **Everything else is autonomous.** Missing tests? Write them. Broken wiring? Fix it. Orphan exports? Delete or wire them. The agent has full authority to make implementation-level decisions within the PRD's boundaries.

### Acceptance Criteria

- [ ] Protocol runs from initiation to convergence without human approval prompts
- [ ] Agent fixes all findings autonomously within PRD boundaries
- [ ] Only stops at: zero findings, ambiguous design decisions, or infinite loop detection
- [ ] Ambiguous stops clearly document what decision is needed and why

---

## The Protocol

### Cycle Structure

```
CYCLE N:
  Step 0: Test file coverage check + test proportionality check
  Step 1: Automated scans (grep-based, output shown)
  Step 2: Write pipeline check (per-endpoint, output shown)
  Step 3: Acceptance criteria audit (per-PRD, evidence table)
  Step 4: Fresh-eyes read (re-read PRD, re-read code, look for what was missed)
  Step 5: Build + test verification (unit, integration, E2E, scorecard)
  Step 6: Behavioral verification (config-driven rendering, real data)

  → If ANY step finds issues:
      Fix them.
      Restart at CYCLE N+1.

  → If ALL steps find zero issues:
      Phase is complete.
      Save results to memory.
      Commit.
```

---

## Step 0: Test File Coverage Check

Before running the cycle, verify that every implementation file created or modified in this phase has a corresponding test file. This is a hard gate — no exceptions.

```bash
# Find implementation files without test files
find src/ -name "*.ts" -not -name "*.test.ts" -not -name "*.integration.test.ts" \
  -not -path "*__tests__*" -not -path "*node_modules*" -not -name "types.ts" \
  | while read f; do
      base="${f%.ts}"
      if [ ! -f "${base}.test.ts" ] && [ ! -f "${base}.integration.test.ts" ]; then
        echo "NO TEST: $f"
      fi
    done
```

**Exceptions (must be justified):**
- `index.ts` — entry point with no testable logic
- `types.ts` — type definitions only
- `__tests__/helpers/*` — test infrastructure

**Every other file must have a test file.** API route handlers need tests verifying: auth enforcement, parameter validation, error responses, correct service calls, audit context/claim, domain event emission. "The service is tested" is not sufficient — the route handler that calls it must also be tested.

**Pass criteria:** Zero `NO TEST` lines for files in the current phase. Missing test files must be created before proceeding to Step 1.

### Test Proportionality Check (R30)

> If a phase has 15 endpoints, 8 migrations, and 4 triggers but only 12 tests, something is
> deeply wrong. Test count must be proportional to implementation complexity.

#### Purpose

Verify that the number of tests is proportional to the number of testable surface areas in the phase. A phase with many endpoints, migrations, and triggers but few tests indicates systematic under-testing — even if the tests that exist all pass.

#### How to Run

```bash
# Count testable surface areas
ENDPOINTS=$(grep -rc "router\.\(get\|post\|put\|patch\|delete\)" src/api/ --include="*.ts" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
MIGRATIONS=$(find src/db/migrations/ -name "*.sql" 2>/dev/null | wc -l)
TRIGGERS=$(grep -c "CREATE.*TRIGGER" src/db/migrations/*.sql 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
SERVICES=$(find src/services/ -name "*.ts" -not -name "*.test.ts" -not -name "types.ts" 2>/dev/null | wc -l)

# Count tests
UNIT_TESTS=$(grep -rc "it(\|test(" src/ --include="*.test.ts" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
INTEGRATION_TESTS=$(grep -rc "it(\|test(" src/ --include="*.integration.test.ts" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
E2E_TESTS=$(grep -rc "it(\|test(" e2e/ --include="*.spec.ts" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
TOTAL_TESTS=$((UNIT_TESTS + INTEGRATION_TESTS + E2E_TESTS))

echo "=== Test Proportionality Report ==="
echo "Endpoints:    $ENDPOINTS"
echo "Migrations:   $MIGRATIONS"
echo "Triggers:     $TRIGGERS"
echo "Services:     $SERVICES"
echo "---"
echo "Unit tests:        $UNIT_TESTS"
echo "Integration tests: $INTEGRATION_TESTS"
echo "E2E tests:         $E2E_TESTS"
echo "Total tests:       $TOTAL_TESTS"
echo "---"
echo "Ratio (tests per endpoint): $(echo "scale=1; $TOTAL_TESTS / ($ENDPOINTS + 1)" | bc)"
```

#### Minimum Ratios

| Surface Area | Minimum Tests Per Item | Rationale |
|---|---|---|
| API endpoint | 3 tests | Auth, validation, happy path (minimum) |
| Migration with triggers | 2 tests | Trigger fires correctly, trigger edge case |
| Service function | 2 tests | Happy path, error path |

#### Pass Criteria

- Total tests >= (endpoints x 3) + (triggers x 2) + (services x 2)
- If the ratio is anomalously low, this is a **FAIL** — not a warning. The phase cannot proceed until test count is proportional.
- Show the proportionality report output. No summarizing — the numbers are the evidence.

---

## Step 1: Automated Scans

These are grep/bash commands. Run them. Show the output. No summarizing — the raw output is the evidence.

### 1a. Dead export scan
```bash
# Find exports with no importers (excluding test files and type-only exports)
for f in $(find src/ -name "*.ts" -not -name "*.test.ts" -not -path "*__tests__*"); do
  grep -n "^export " "$f" | while read line; do
    sym=$(echo "$line" | sed 's/.*export \(async \)\?function //' | sed 's/export const //' | sed 's/export class //' | cut -d'(' -f1 | cut -d' ' -f1 | cut -d':' -f1 | cut -d'<' -f1)
    if [ -n "$sym" ] && [ "$sym" != "type" ] && [ "$sym" != "interface" ]; then
      importers=$(grep -rl "import.*$sym\|{ $sym\|, $sym\|$sym }" src/ --include="*.ts" | grep -v "$f" | grep -v ".test.ts" | wc -l)
      if [ "$importers" -eq 0 ]; then
        echo "ORPHAN: $sym in $f"
      fi
    fi
  done
done
```

**Pass criteria:** Zero ORPHAN lines. Every orphan must be either wired or deleted.

### 1b. Orphan column scan
```bash
# For each column in migrations, check if any .ts file references it
grep -oP '^\s+(\w+)\s+(UUID|TEXT|INTEGER|BOOLEAN|JSONB|TIMESTAMPTZ|INET|DATE|TEXT\[\])' \
  src/db/migrations/*.sql \
  | awk '{print $1}' | sort -u \
  | while read col; do
    # Skip auto-populated columns
    case "$col" in id|created_at|updated_at|changed_at) continue;; esac
    ts_refs=$(grep -rl "$col" src/ --include="*.ts" --exclude-dir="__tests__" --exclude="*.test.ts" --exclude="*.sql" | wc -l)
    if [ "$ts_refs" -eq 0 ]; then
      echo "ORPHAN COLUMN: $col"
    fi
  done
```

**Pass criteria:** Zero ORPHAN COLUMN lines. Every column must be read or written by application code.

### 1c. Import without call scan
```bash
# Find imports that are never called in the importing file
# (catches "imported withAuditContext but never called it")
# This is a manual check guided by the automated import list
grep -rn "^import " src/ --include="*.ts" --exclude="*.test.ts" --exclude-dir="__tests__"
```

Review the output: for each imported symbol, verify it's actually called (not just imported). Focus on cross-module dependencies identified in PRDs.

---

## Step 2: Write Pipeline Check

For EVERY file in `src/api/` that handles POST/PUT/DELETE, verify each pipeline step. This is a table — fill it in, show it.

```markdown
### File: src/api/domains.ts

| Step | What | Present? | Evidence (line #) |
|------|------|----------|-------------------|
| Auth | requireAuth in middleware chain | ? | |
| RBAC gate | canPerformAction before write | ? | |
| Payload filter | filterWritePayload on req.body | ? | |
| Input validation | validateCondition for JSONB conditions | ? | |
| PII encryption | encryptPiiFields before write | ? | |
| HMAC index | computeHmac for email fields | ? | |
| Audit context | withAuditContext wrapping DB write | ? | |
| DB write via client | client.query (not pool query) | ? | |
| Audit claim | logAuditClaim after write | ? | |
| Domain event | createDomainEvent + emit | ? | |
| Event change_set | change_set passed to event/event_log | ? | |
| Response filter | filterRecord + decryptPiiFields | ? | |
```

**Fill this table for every write endpoint.** A "?" or "NO" is a finding. Fix it before proceeding.

---

## Step 3: Acceptance Criteria Audit

For EVERY PRD in the phase, find every `- [ ]` acceptance criteria. For each:

```markdown
### PRD: core/audit-system.md, Section 1

| # | Criterion text (copied from PRD) | Status | Implementation evidence | Test evidence |
|---|----------------------------------|--------|------------------------|---------------|
| 1 | "Every API handler passes a populated AuditContext" | ? | file:line | test name |
| 2 | "Actor type is one of five enum values; CHECK enforces" | ? | migration file:line | test name |
```

**Rules:**
- Copy the criterion text exactly from the PRD — don't paraphrase
- Implementation evidence = file path + line number where the code exists
- Test evidence = test file + test name that verifies this specific criterion
- A criterion without BOTH implementation AND test evidence is a FAIL
- A criterion that references something not wired (per Step 1) is a FAIL even if code "exists"

---

## Step 4: Fresh-Eyes Read

This step prevents the "I wrote it so I know it works" bias.

1. **Re-read the PRD.** Not from memory — open the file, read it top to bottom.
2. **Re-read the code.** Not from memory — open the implementation file, read it.
3. **Ask:** "If I were seeing this code for the first time, would I believe it implements the PRD?"
4. **Look for:** things the automated scans can't catch:
   - Logic errors (e.g., encryption happening BEFORE RBAC filter instead of after)
   - Missing edge cases (e.g., what happens when encryption key isn't configured?)
   - Semantic mismatches (e.g., PRD says "HMAC-SHA256" but code uses "SHA-256" without HMAC)
   - Order-of-operations errors (e.g., audit claim logged before the write, so a write failure leaves a phantom claim)

**Document any findings.** If zero, explicitly state "Fresh-eyes pass found zero issues."

---

## Step 5: Build + Test Verification (R40)

> "Was this tested? E2E? Integration? Completion process?" — If you can't answer yes to all
> of these, it wasn't tested. A green unit test suite is necessary but nowhere near sufficient.

### Purpose

Verify that the full testing pyramid passes: unit tests, integration tests, AND end-to-end tests. A phase is not verified by partial testing. All three layers must run and produce visible output.

```bash
# ALL of these must succeed — show output for each
npx tsc --noEmit                                    # TypeScript compiles
npx vitest run                                       # Unit tests pass
npx vitest run --config vitest.integration.config.ts # Integration tests pass
npx playwright test                                  # E2E tests pass
```

**Show the output.** Not "tests pass" — show the actual test runner output with counts for each layer.

### Completion Scorecard

Before this step can pass, fill in and show the scorecard:

```markdown
| Gate | Status | Evidence |
|------|--------|----------|
| TypeScript compiles (`tsc --noEmit`) | ? | output |
| Unit tests pass (vitest) | ? | X passing, Y failing |
| Integration tests pass (vitest integration config) | ? | X passing, Y failing |
| E2E tests pass (playwright) | ? | X passing, Y failing |
| Test proportionality check (Step 0) | ? | ratio |
| No orphan exports (Step 1a) | ? | count |
| No orphan columns (Step 1b) | ? | count |
| All write pipelines complete (Step 2) | ? | endpoint count |
| All acceptance criteria have evidence (Step 3) | ? | criteria count |
| Fresh-eyes pass clean (Step 4) | ? | finding count |
| Behavioral verification passes (Step 6) | ? | page count |
```

**Every row must be PASS with evidence.** A single FAIL means the cycle has findings — fix and restart.

### Acceptance Criteria

- [ ] Unit tests run and output is shown with counts
- [ ] Integration tests run and output is shown with counts
- [ ] E2E tests run and output is shown with counts
- [ ] Completion scorecard is filled in with all rows PASS
- [ ] No test layer is skipped — missing layer is a FAIL, not "N/A"

---

## Step 6: Behavioral Verification (R38)

> "Tests pass" and "build succeeds" are not verification. If you can't navigate to the page,
> load real data from the DB, and see it rendered through ViewConfig/FormConfig/PageConfig,
> you haven't verified anything. You've verified that code compiles — not that it works.

### Purpose

Verify that real user actions render correctly through the platform's config-driven renderers, end-to-end. This step catches the gap between "code exists and tests pass" and "the application actually works when a human uses it." A page that loads but renders nothing because the ViewConfig references a field name that doesn't match the DB column is a failure — even if every unit test is green.

### What to Verify

For every user-facing page/view affected by this phase:

1. **Navigate to the actual page** in the running application (dev server or E2E browser)
2. **Load actual data from the database** — not mocked data, not fixture data, real rows from Postgres
3. **Confirm rendering through config-driven renderers:**
   - ViewConfig fields match actual DB column names
   - FormConfig fields produce working form inputs
   - PageConfig routes resolve to the correct components
   - List views show real records with correct field values
   - Detail views display all configured fields
   - Forms submit and persist correctly

### Evidence Table

```markdown
### Behavioral Verification: Phase N

| Page/View | Route | Data Source | Records Loaded | Fields Rendered | Config Match | Status |
|-----------|-------|-------------|----------------|-----------------|--------------|--------|
| Domain list | /domains | domains table | 5 rows | name, status, created_at | ViewConfig verified | ? |
| Domain detail | /domains/:id | domains table | 1 row | all 12 fields | ViewConfig verified | ? |
| Domain create | /domains/new | N/A (form) | N/A | 8 form fields | FormConfig verified | ? |
```

### Common Failures This Step Catches

- ViewConfig references `organization_name` but DB column is `org_name`
- FormConfig defines a dropdown field but the options endpoint returns 404
- PageConfig routes to a component that doesn't import the data fetching hook
- List view renders but shows 0 records because the API query has a WHERE clause bug
- Detail view loads but half the fields show "undefined" because of snake_case/camelCase mismatch

### Pass Criteria

- Every page/view affected by the phase has a row in the evidence table
- Every row has Status = PASS with visible evidence (screenshot, console output, or E2E assertion)
- "I checked and it works" is not evidence. Show the rendered output or the E2E test assertion.

### Acceptance Criteria

- [ ] Every user-facing page affected by the phase is tested against real DB data
- [ ] ViewConfig/FormConfig/PageConfig field names match actual DB column names
- [ ] Config-driven renderers produce correct output (not empty, not "undefined")
- [ ] Evidence is shown for each page (screenshot, E2E output, or rendered HTML)

---

## Convergence

```
CYCLE 1: Run Steps 0-6
  → Found 10 issues (wiring gaps, missing pipeline steps)
  → Fix all 10
  
CYCLE 2: Run Steps 0-6 again (fixes may have introduced new issues)
  → Found 2 issues (fix for #3 broke a test, fix for #7 created an orphan import)
  → Fix both

CYCLE 3: Run Steps 0-6 again
  → Zero issues found across all 7 steps
  → Phase is complete.
```

**The cycle count is not bounded.** It takes as many cycles as needed. Declaring "close enough" after Cycle 1 is the exact shortcut this protocol exists to prevent.

---

## Retroactive Application (R31)

> When the protocol changes, every phase completed under the old standard must be re-verified
> under the new standard. New rules apply retroactively. No grandfathering.

### Purpose

The completion protocol is a living document. When new steps, checks, or requirements are added, phases that were previously "complete" may no longer meet the standard. A phase completed before Step 6 (Behavioral Verification) existed was never behaviorally verified — and that gap doesn't get grandfathered in.

### Rules

1. **New rules apply retroactively.** When the protocol is updated (new step added, existing step strengthened, new proportionality check, etc.), ALL previously completed phases must be re-verified under the new standard.
2. **Re-verification uses the current protocol.** Not the version that existed when the phase was originally completed. The whole point is that the old version was insufficient.
3. **Re-verification follows Protocol Independence (R28).** The re-verifying agent starts cold — no knowledge of what passed before, no assumptions about what's "probably fine."
4. **Re-verification follows Autonomy (R29).** Once initiated, it cycles to convergence without approval gates.
5. **Track protocol versions.** Each completion report should note which version of the protocol was used. When the protocol changes, reports completed under prior versions are flagged for re-verification.

### When This Triggers

- A new Step is added (e.g., Step 6: Behavioral Verification)
- An existing Step's pass criteria are strengthened (e.g., Step 5 now requires E2E)
- A new proportionality check is added (e.g., R30 test proportionality)
- A new section is added that affects what "complete" means (e.g., R28, R29)

### Process

```
1. Protocol is updated (this document changes)
2. Identify all phases completed under the prior version
3. For each such phase, initiate a fresh completion cycle:
   "Verify Phase N under the current protocol"
4. Each phase must converge to zero findings under the NEW standard
5. Update the completion report with the new cycle results
```

### Acceptance Criteria

- [ ] Protocol changes trigger re-verification of all previously completed phases
- [ ] Re-verification uses the current (updated) protocol, not the version used originally
- [ ] Re-verification follows R28 (protocol independence) and R29 (autonomy)
- [ ] Completion reports note which protocol version was used
- [ ] No phase is grandfathered — all must meet the current standard

---

## Output Artifact

Each cycle produces a report. The final cycle's report (the one with zero findings) is saved to project memory as `project_phase{N}_completion.md`.

Format:
```markdown
## Phase N Completion Report — Cycle {final_cycle_number}
### Protocol Version: {date or version of phase-completion.md used}

### Step 0: Test Coverage + Proportionality
- Missing test files: 0 found
- Test proportionality: {ratio} (meets minimum)

### Step 1: Automated Scans
- Dead exports: 0 found
- Orphan columns: 0 found
- Unimported calls: 0 found

### Step 2: Write Pipeline
[completed tables for each write endpoint]

### Step 3: Acceptance Criteria
[completed tables for each PRD section]

### Step 4: Fresh-Eyes
Fresh-eyes pass found zero issues.

### Step 5: Build + Test
- TypeScript: clean
- Unit tests: {count} passing
- Integration tests: {count} passing
- E2E tests: {count} passing
- Completion scorecard: all gates PASS

### Step 6: Behavioral Verification
[evidence table for each page/view]

### Conclusion
Phase N passes all verification gates after {N} cycles.
```

---

## Acceptance Criteria (for this PRD)

- [ ] Phase completion uses the iterative cycle (not a single-pass check)
- [ ] Each step produces documented output (not "I checked, it's fine")
- [ ] Fixes trigger a restart from Cycle N+1 (not "I fixed it, continuing from where I was")
- [ ] The protocol converges to zero findings before phase is declared complete
- [ ] Final cycle report saved to project memory
- [ ] No step is skippable — missing output for any step means the cycle is invalid
- [ ] Protocol runs without pre-seeding the verifier with known issues (R28)
- [ ] Protocol runs autonomously without mid-cycle human approval (R29)
- [ ] Test count is proportional to implementation complexity (R30)
- [ ] Protocol changes trigger retroactive re-verification of completed phases (R31)
- [ ] Behavioral verification confirms real rendering through config-driven renderers (R38)
- [ ] All three test layers (unit, integration, E2E) run with visible output and a scorecard (R40)
