# Phase Completion Protocol

> A phase is complete when a full verification cycle finds ZERO issues. Not when the code exists.
> Not when tests pass. Not when it "looks done." When an iterative, multi-pass audit converges
> to zero findings. Every pass is documented. Every fix triggers a re-run. Shortcuts are visible
> because every step produces auditable output.

---

## Overview

The most dangerous moment in this project is when someone says "Phase N is complete." Every previous declaration of completion was wrong — the code existed but wasn't wired, tests passed but didn't cover the acceptance criteria, modules were implemented but not connected.

This protocol makes it structurally difficult to shortcut. Each step produces concrete, verifiable output. Skipping a step is visible because the output is missing. Finding an issue resets the cycle, because fixes can introduce new issues.

**The protocol is iterative.** It runs in cycles until a complete cycle finds zero issues. There is no fixed number of passes — you keep going until clean.

---

## The Protocol

### Cycle Structure

```
CYCLE N:
  Step 1: Automated scans (grep-based, output shown)
  Step 2: Write pipeline check (per-endpoint, output shown)
  Step 3: Acceptance criteria audit (per-PRD, evidence table)
  Step 4: Fresh-eyes read (re-read PRD, re-read code, look for what was missed)
  Step 5: Build + test verification

  → If ANY step finds issues:
      Fix them.
      Restart at CYCLE N+1.

  → If ALL steps find zero issues:
      Phase is complete.
      Save results to memory.
      Commit.
```

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

## Step 5: Build + Test Verification

```bash
# Must all succeed
npx tsc --noEmit                                    # TypeScript compiles
npx vitest run                                       # Unit tests pass
npx vitest run --config vitest.integration.config.ts # Integration tests pass (if Docker available)
```

**Show the output.** Not "tests pass" — show the actual test runner output with counts.

---

## Convergence

```
CYCLE 1: Run Steps 1-5
  → Found 10 issues (wiring gaps, missing pipeline steps)
  → Fix all 10
  
CYCLE 2: Run Steps 1-5 again (fixes may have introduced new issues)
  → Found 2 issues (fix for #3 broke a test, fix for #7 created an orphan import)
  → Fix both

CYCLE 3: Run Steps 1-5 again
  → Zero issues found across all 5 steps
  → Phase is complete.
```

**The cycle count is not bounded.** It takes as many cycles as needed. Declaring "close enough" after Cycle 1 is the exact shortcut this protocol exists to prevent.

---

## Output Artifact

Each cycle produces a report. The final cycle's report (the one with zero findings) is saved to project memory as `project_phase{N}_completion.md`.

Format:
```markdown
## Phase N Completion Report — Cycle {final_cycle_number}

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
