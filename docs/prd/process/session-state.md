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

## 3. Memory Hygiene

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

---

## 4. Mandatory Save Points

| Event | Memory type | What to save |
|-------|-------------|-------------|
| User corrects approach | feedback | The rule + why + how to apply |
| User confirms approach | feedback | What was confirmed (validated judgment call) |
| Phase acceptance gate passes | project | Phase status, test counts, what's next |
| Gap analysis produced | project | Key findings, what's missing |
| Architecture decision made | project | Decision + rationale |
| New external resource discovered | reference | What it is + where to find it |
| Session ends with incomplete work | project | What's in progress, what's blocked, next steps |

---

## 5. Acceptance Criteria

- [ ] Feedback saved within the same response as the correction (not deferred)
- [ ] Phase completion triggers a project state memory update
- [ ] Gap analyses are saved with key findings, not just "see the earlier message"
- [ ] MEMORY.md index updated after every new memory file
- [ ] No session ends with important unsaved state
