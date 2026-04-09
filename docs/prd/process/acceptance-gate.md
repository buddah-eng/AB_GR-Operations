# Acceptance Gate

> Before any phase is declared complete, every acceptance criteria in every PRD for that phase
> must be checked line-by-line. Not summarized, not estimated — checked. Each criterion gets
> a status (pass/fail/NA) with evidence (file path + line number or test name).

---

## Overview

The pattern that causes incomplete phases is declaring completion based on "the code exists and tests pass" without verifying that the code satisfies every specific acceptance criteria in the PRD. Unit tests prove the module works in isolation; acceptance criteria prove it works as specified.

This PRD defines a mandatory gate that requires line-by-line verification of every acceptance criteria before a phase advances.

---

## 1. Procedure

### For each PRD in the phase:

1. Open the PRD file
2. Find every `- [ ]` acceptance criteria checkbox (search for `- [ ]`)
3. For each criterion, determine:
   - **PASS**: Code exists, is wired into the application, and is tested. Cite the evidence.
   - **FAIL**: Code is missing, exists but is unwired, or exists but is untested.
   - **N/A**: Criterion doesn't apply to the current implementation stage (e.g., "CI pipeline runs" before CI is set up). Must be justified.
4. Document the results in a structured report

### Report format:

```markdown
## PRD: core/audit-system.md

### Section 1: Actor Types
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Every API handler passes a populated AuditContext | PASS | domains.ts:218 withAuditContext, actions.ts:145 withAuditContext |
| 2 | Actor type CHECK constraint enforces | PASS | 001-foundation.sql:390, schema.integration.test.ts:test4 |
| 3 | Trigger fallback to system/pg_trigger_fallback | PASS | triggers.integration.test.ts:test5 |

### Section 2: Audit Log Tables
...
```

---

## 2. Evidence Requirements

| Status | Required evidence |
|--------|-------------------|
| PASS | File path + line number where the implementation exists, AND test name that verifies it |
| FAIL | Description of what's missing + why it wasn't caught earlier |
| N/A | Justification for why this criterion doesn't apply yet |

**"The code exists" is not evidence for PASS.** The code must be:
1. Implemented (file + line)
2. Wired (called from the application path, per wiring-audit.md)
3. Tested (unit test name or integration test name)

---

## 3. Failure Response

When any criterion is **FAIL**:

1. Create a task to fix it
2. Fix it (code + test)
3. Re-run the acceptance gate for the affected PRD section
4. Only advance when all criteria are PASS or justified N/A

**No batching failures for later.** A FAIL in Phase 2 is not acceptable to defer to Phase 3. Fix it now.

---

## 4. Memory Gate

After the acceptance gate passes:

1. Save the audit results to project memory (file: `project_phase{N}_gate.md`)
2. Update the phase status in memory
3. Record any lessons learned as feedback memories

This ensures future sessions have context on what was verified and how.

---

## 5. Acceptance Criteria (for this PRD)

- [ ] Every phase completion includes a line-by-line acceptance criteria audit
- [ ] Audit report is structured with evidence for each criterion
- [ ] No FAIL criteria allowed at phase completion
- [ ] Results saved to project memory
- [ ] Gate blocks phase advancement until all criteria pass
