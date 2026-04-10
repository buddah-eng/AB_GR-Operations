# Session State Management

> Save state as it happens — not when asked. Every correction, every gap analysis, every phase
> completion gets recorded to memory immediately. Future sessions start with full context instead
> of rediscovering what was already known.

---

## Overview

Context is lost between sessions. Without persistent memory, each session rediscovers the same gaps, repeats the same mistakes, and wastes time re-auditing work that was already verified. This PRD defines what must be saved, when, and how.

---

## 1. What Gets Saved

### 1.1 Feedback Memories (type: feedback)
**Trigger:** Any time the user corrects approach, confirms a non-obvious choice, or provides working-style guidance.

Save immediately — not at end of session, not when asked. Include:
- The rule itself
- **Why** (what went wrong that prompted the correction)
- **How to apply** (when this rule kicks in)

**NON-NEGOTIABLE:** Every user correction is a memory event. There is no threshold of significance — if the user corrected you, save it. Do not batch corrections for later. Do not assume you will remember without writing it down. If you are unsure whether something qualifies as a correction, save it anyway. Memory is not optional.

> "have you been learning lessons for the memory?"

### 1.2 Project State Memories (type: project)
**Trigger:** Phase completion, gap analysis results, architecture decisions.

Save after:
- Completing a phase (save: what's done, test counts, what's next)
- Running a gap analysis (save: what's missing, what needs fixing)
- Making an architecture decision (save: what was decided and why)
- Discovering a non-obvious project fact (save: the fact with context)

### 1.3 Reference Memories (type: reference)
**Trigger:** Learning about external systems, tools, or resources.

Save when discovering:
- Repository locations, branch conventions
- Tech stack specifics
- CI/CD configuration
- External service integrations

---

## 2. When to Check Memory

### At session start:
- Read MEMORY.md index
- Load relevant memories for the current task
- Verify project state memories are still accurate (git log may show changes since last session)

### Before answering "is it done?":
- Check project state memory for last known status
- Verify current code matches the saved state
- If memory says "Phase 2 gap: email_hmac not populated" — check if it's been fixed since

### Before starting a new phase:
- Load phase status memory
- Load feedback memories (to avoid repeating mistakes)
- Verify previous phase's acceptance gate results

---

## 3. PRD Discovery Protocol

**R33 — Mandatory PRD discovery before writing new PRDs.**

Before drafting ANY new PRD, the agent MUST read the following files — no exceptions:

1. **`_context-index.md`** — Understand what PRDs already exist across all subfolders
2. **`_orchestration.md`** — Understand phase structure, build order, and dependencies
3. **Relevant subfolder PRDs** — Read every PRD in the subfolder(s) that touch the topic being written about

Only after completing this discovery may the agent begin drafting. If discovery reveals that existing PRDs already cover the topic, do not create a duplicate — extend or reference the existing PRD instead.

> "be sure to do full discovery and exploration on existing prd's before writing new ones"

### R34 — PRD count must match user specification

When the user specifies an exact count of PRDs to produce:

1. **Audit first** — Read existing PRDs to understand what already exists and what gaps remain
2. **Confirm the count** — Before writing, confirm back to the user: "I will produce exactly N PRDs covering X, Y, Z"
3. **Produce exactly that count** — Not more, not fewer. If the scope doesn't cleanly divide into the specified count, ask the user rather than silently adjusting
4. **Verify after writing** — Count the PRDs produced and confirm the number matches the specification

Producing the wrong number of PRDs — whether by splitting topics too finely or combining them too aggressively — indicates the agent did not read the user's message carefully.

> "4 prd's, did you not read my message"

---

## 4. Memory Hygiene

### Update, don't duplicate
- Before creating a new memory, check if one exists that should be updated
- Phase status memories get overwritten (not appended) when phase status changes
- Feedback memories are permanent unless the user says to remove them

### Keep the index clean
- MEMORY.md stays under 200 lines
- Each entry is one line with a brief description
- Organize semantically, not chronologically

### Verify before recommending from memory
- If a memory references a file path: verify the file still exists
- If a memory references a function: grep for it
- Stale memories get updated or removed

### R37 — Lesson saving is non-negotiable
Every session MUST end with a memory audit. Before the session closes:

1. Review every user correction that occurred during the session
2. Confirm each one has been saved as a feedback memory
3. If any correction was missed, save it now — do not let the session end without it

Memory saving is not a suggestion. It is not "when convenient." It is a mandatory operation that happens after every correction and is verified before every session ends. An agent that forgets lessons forces the user to repeat themselves — this is the single most disrespectful failure mode.

> "have you been learning lessons for the memory?"

---

## 5. Mandatory Save Points

| Event | Memory type | What to save |
|-------|-------------|-------------|
| User corrects approach | feedback | The rule + why + how to apply |
| User confirms approach | feedback | What was confirmed (validated judgment call) |
| Phase acceptance gate passes | project | Phase status, test counts, what's next |
| Gap analysis produced | project | Key findings, what's missing |
| Architecture decision made | project | Decision + rationale |
| New external resource discovered | reference | What it is + where to find it |
| Session ends with incomplete work | project | What's in progress, what's blocked, next steps |
| PRD discovery completed | project | What PRDs were read, what gaps were identified |
| Session ends (always) | feedback | Verify all corrections saved; save any that were missed |

---

## 6. Acceptance Criteria

- [ ] Feedback saved within the same response as the correction (not deferred)
- [ ] Phase completion triggers a project state memory update
- [ ] Gap analyses are saved with key findings, not just "see the earlier message"
- [ ] MEMORY.md index updated after every new memory file
- [ ] No session ends with important unsaved state
- [ ] Every user correction during a session results in a saved memory (R37)
- [ ] Session-end memory audit confirms no corrections were missed (R37)
- [ ] PRD drafting is preceded by reading `_context-index.md`, `_orchestration.md`, and relevant subfolder PRDs (R33)
- [ ] PRD count matches user specification exactly when a count is given (R34)
- [ ] PRD count is confirmed with the user before writing begins (R34)
