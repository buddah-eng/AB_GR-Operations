# Deferred Backlog

> A living document that tracks every acceptance criterion deferred from its original phase.
> Each item has a gate condition — the specific thing that must happen before the item can be
> implemented. Gates are checked at the start of every phase. When a gate is met, the deferred
> item becomes a requirement of the current phase.

---

## Overview

Some acceptance criteria cannot be met during their original phase because they depend on infrastructure, external services, or later-phase features that don't exist yet. Deferring is acceptable IF:

1. The PRD itself acknowledges the gap (e.g., "Planned" in an implementation status table)
2. The deferral is documented here with a specific gate condition
3. The gate is checked at the start of every subsequent phase

Deferring without documentation is a shortcut. Deferring without a gate condition means it never gets done.

---

## Active Deferrals

| ID | Item | Source PRD | Section | Gate Condition | Status |
|----|------|-----------|---------|----------------|--------|
| D-001 | Redis cross-instance cache invalidation for ontology | core/ontology-engine.md | §3 Caching | Cloud Run migration (platform/scaling.md) is implemented — multi-instance deployment requires shared cache | DEFERRED |
| D-002 | Frontend component testing infrastructure (Vitest + Vue Test Utils) | Phase 4.5 (all frontend PRDs) | Frontend test infrastructure established (vitest config, vue-test-utils installed, test patterns defined) | DEFERRED |

---

## Resolved Deferrals

| ID | Item | Resolved In | How |
|----|------|-------------|-----|
| (none yet) | | | |

---

## Process

### When to add a deferral
- During the acceptance gate (process/acceptance-gate.md), when a criterion cannot be met
- The PRD must acknowledge the gap — you cannot defer something the PRD says is required without amending the PRD
- Document: ID, item description, source PRD + section, specific gate condition

### When to check gates
- **At the start of every phase:** review all active deferrals. If a gate condition is now met (because the blocking work was done in a previous phase), the deferred item becomes a requirement of the current phase.
- **When implementing infrastructure PRDs:** check if any deferrals are gated on the infrastructure being implemented.

### When to resolve
- When the deferred item is implemented, move it from Active to Resolved with the phase/commit where it was done.

### Gate condition rules
- Must be specific: "Cloud Run migration is implemented" not "when we get around to it"
- Must reference a specific PRD or deliverable that unblocks it
- If the gate condition changes (e.g., the blocking PRD is rescoped), update the gate
- If the gate will never be met (e.g., feature is cancelled), remove the deferral and amend the source PRD

---

## Acceptance Criteria (for this process)

- [ ] Every deferred acceptance criterion appears in the Active Deferrals table
- [ ] Every deferral has a specific, verifiable gate condition
- [ ] Gates are checked at the start of every phase
- [ ] Resolved deferrals are tracked with implementation evidence
- [ ] No deferral exists without the source PRD acknowledging the gap
