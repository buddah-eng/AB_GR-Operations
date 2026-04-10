# Phase Discipline

> One phase at a time. One PRD at a time within a phase. Read the full PRD before writing code.
> Don't combine phases. Don't skip ahead. Don't mark done until the acceptance gate passes.

---

## Overview

The largest source of rework in this project has been advancing to later phases before current phases are complete. Phase 3 code was built on a Phase 2 foundation that was 60% done, requiring deletion of all Phase 3+ code and a restart.

This PRD encodes the operational discipline that prevents this pattern.

---

## 1. Phase Execution Rules

### 1.1 Sequential Phase Advancement (R26)
- Phase N+1 cannot begin until Phase N passes its acceptance gate (acceptance-gate.md)
- No "starting Phase 3 while finishing Phase 2" — finish means FINISHED
- The orchestration plan defines phase order. Follow it.
- Each phase must be executed and verified INDEPENDENTLY. Never combine phases, even if they seem related.
- "Phases 5 and 6 look similar" is not a reason to merge them. Similarity is exactly why they must be separated — similar work hides incomplete work.
- If two phases touch overlapping areas, that is MORE reason to isolate them, not less.

> **User feedback:** "I don't like how you did 5 and 6 together, it makes me nervous"

### 1.2 One PRD at a Time
- Within a phase, work through PRDs in dependency order (per orchestration plan)
- Read the FULL PRD (not a summary) before writing any code
- Implement all acceptance criteria for that PRD before starting the next one
- Exception: parallel tracks identified in the orchestration plan can run simultaneously via subagents

### 1.3 No Phase Combining
- Each phase gets its own commit(s) and verification
- Do not bundle Phase 5 and Phase 6 into one commit
- Each phase's verification must be independently reviewable

### 1.4 Read Before Write
- Before implementing a PRD, read:
  1. The full PRD (all sections, all acceptance criteria)
  2. All upstream dependency PRDs referenced in the Dependencies section
  3. The existing code that will be modified
- Do not implement from summaries, agent reports, or memory of what the PRD says

### 1.5 Foundation Verification (R32)

Before ANY Phase N work begins, validate that Phase N-1 is truly complete. "The gate passed last week" is not sufficient — re-verify NOW.

**Required steps before starting Phase N:**
1. **Re-run the wiring audit** on all Phase N-1 deliverables. Not "check that it passed before" — run it again, right now.
2. **Verify acceptance criteria still hold.** Subsequent work (hotfixes, dependency updates, refactors) may have introduced regressions. Every acceptance criterion from Phase N-1 must be re-confirmed.
3. **Confirm no regressions from intervening work.** If any code was touched between Phase N-1 completion and Phase N start, re-validate the affected areas.
4. **If ANY check fails, Phase N cannot begin.** Return to Phase N-1, fix the issue, re-pass the gate, then attempt Phase N again.
5. **If Phase N-1 cannot be verified, ALL subsequent phases are invalid.** There is no "well Phase N-1 is mostly fine." Mostly fine is not fine.

> **User feedback:** "restart from phase 2 entirely, phase 3+ is built on a house of lies"

**Rationale:** Every phase is a foundation for the next. An unverified foundation means everything built on top of it is suspect. The cost of re-running a gate is minutes. The cost of building on a broken foundation is days of rework and deletion.

---

## 2. Progress Tracking Rules

### 2.1 Task Granularity
- Create one task per PRD (not per phase)
- Mark in_progress when starting, completed only when acceptance gate passes
- Never mark completed if tests are failing, implementation is partial, or acceptance criteria are unverified

### 2.2 Honest Status Reporting
- When asked "is it done?" — check, don't guess
- Run the wiring audit, write pipeline check, and acceptance gate before answering
- "The code exists" ≠ "it's done"
- "Tests pass" ≠ "acceptance criteria met"

### 2.3 Memory Updates
- After completing a phase: save phase status to project memory
- After receiving feedback: save as feedback memory immediately
- After discovering a project fact: save as project memory
- Don't wait to be asked — save proactively

---

## 3. Subagent Rules

### 3.1 When to Parallelize
- Only within a phase, for PRDs identified as parallel tracks in the orchestration plan
- Never cross-phase parallelism
- Never parallelize PRDs that modify the same file

### 3.2 Integration After Parallelism
- After parallel agents complete, verify the combined result compiles and all tests pass
- Run the wiring audit on the combined changes
- Fix integration issues before proceeding

---

## 4. Recovery Rules

### 4.1 When Things Go Wrong
- If a phase is discovered to be incomplete after advancing: STOP advancing
- Delete the incomplete downstream work
- Fix the current phase
- Re-run the acceptance gate
- Only then resume forward progress

### 4.2 Root Cause
- When forced to restart, document WHY in a feedback memory
- Identify the specific discipline failure (skipped reading PRD, didn't run acceptance gate, etc.)
- The memory prevents repeating the same mistake

### 4.3 Gap Resolution (R35)

Any gap discovered during implementation MUST be resolved immediately. "I have gaps" is NOT an acceptable status. Every gap must result in one of two outcomes:

**Option A: Fix in the current phase.**
- If the gap is within scope and can be addressed now, fix it before proceeding.
- The gap is not "noted" — it is closed.

**Option B: Create a PRD entry.**
- If the gap cannot be fixed in the current phase, it MUST be captured as a new PRD entry with:
  - Clear description of the gap
  - A `deferred-backlog` gate condition specifying WHEN it will be addressed
  - Acceptance criteria for closing the gap
- A PRD entry is not a wish list item. It is a commitment. Every PRD entry must eventually be implemented.

**What is NOT acceptable:**
- Listing gaps in a status report without a PRD entry
- Deferring gaps verbally ("we'll get to it later") without a written PRD
- Marking a phase complete while known gaps exist without PRD entries
- Creating PRD entries and then ignoring them — if it's in a PRD, it gets built

> **User feedback:** "if they're in a PRD they should be done? and if they're not in a prd, start making prd's"

---

## 5. Acceptance Criteria

- [ ] No phase begins before the previous phase passes its acceptance gate
- [ ] Each PRD is read in full before implementation begins
- [ ] Phases are never combined in a single commit
- [ ] Status reporting is verified (grep/check) not estimated
- [ ] Memory is updated after every phase completion and every feedback event
- [ ] (R26) Each phase is executed and verified independently — no combining, no bundling, no "they're related so we did them together"
- [ ] (R32) Before Phase N begins, Phase N-1 acceptance gate is re-run (not just confirmed from memory) and all criteria re-verified
- [ ] (R32) If Phase N-1 re-verification fails, Phase N is blocked until the foundation is repaired
- [ ] (R35) Every discovered gap has either a fix in the current phase or a new PRD entry with a deferred-backlog gate condition
- [ ] (R35) No gap exists without a PRD entry, and no PRD entry is left unimplemented
