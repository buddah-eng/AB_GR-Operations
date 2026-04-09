# Phase Discipline

> One phase at a time. One PRD at a time within a phase. Read the full PRD before writing code.
> Don't combine phases. Don't skip ahead. Don't mark done until the acceptance gate passes.

---

## Overview

The largest source of rework in this project has been advancing to later phases before current phases are complete. Phase 3 code was built on a Phase 2 foundation that was 60% done, requiring deletion of all Phase 3+ code and a restart.

This PRD encodes the operational discipline that prevents this pattern.

---

## 1. Phase Execution Rules

### 1.1 Sequential Phase Advancement
- Phase N+1 cannot begin until Phase N passes its acceptance gate (acceptance-gate.md)
- No "starting Phase 3 while finishing Phase 2" — finish means FINISHED
- The orchestration plan defines phase order. Follow it.

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

---

## 5. Acceptance Criteria

- [ ] No phase begins before the previous phase passes its acceptance gate
- [ ] Each PRD is read in full before implementation begins
- [ ] Phases are never combined in a single commit
- [ ] Status reporting is verified (grep/check) not estimated
- [ ] Memory is updated after every phase completion and every feedback event
