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
| D-003 | SSE connection timeout on Vercel (300s max) | ui/operational-ux-gaps.md | §13 Vercel Considerations | Vercel migrates to dedicated compute (Fluid Compute long-running), OR canvas real-time polling replaces SSE, OR platform deploys to Cloud Run | DEFERRED |
| D-004 | Relation-based data scoping for liaison role (join-through pairings) | core/rbac-completion.md | §4 Data Scope Extension | RBAC engine's `buildDataScopeFilter` extended to support subquery-based scoping (`AND id IN (SELECT guest_id FROM pairings WHERE staff_id = $uid)`) | DEFERRED |

---

## Resolved Deferrals

| ID | Item | Resolved In | How |
|----|------|-------------|-----|
| (none yet) | | | |

---

## Process

### Phase-Start Gate Review (R36)

At the start of every phase, ALL active deferrals MUST be reviewed as a mandatory gate:

1. Walk the entire Active Deferrals table
2. For each deferral, evaluate whether the gate condition is now met
3. If a gate condition IS met, the deferred item **becomes a current-phase requirement** — it CANNOT be deferred again
4. If a gate condition is NOT met, document why and what phase is expected to unblock it
5. If a gate will never be met (feature cancelled, PRD rescoped), remove the deferral and amend the source PRD

This review is blocking. No phase implementation begins until the gate review is complete and the results are recorded.

### Living Document Protocol (R36)

> "Also where are we tracking a cohesive deferred orchestration plan with gates" — User

This document is the single source of truth for deferred work. It MUST be updated whenever:

- **A new deferral is added** — during the acceptance gate, when a criterion cannot be met
- **A gate condition changes** — due to PRD rescoping, infrastructure changes, or feature cancellation
- **A phase begins** — gate review results are recorded (see Phase-Start Gate Review above)
- **A deferral is resolved** — moved from Active to Resolved table with implementation evidence

Staleness is a defect. If this document does not reflect the current state of all deferred work, the process is broken.

### No Orphan Deferrals (R36)

Every deferral MUST trace to a specific acceptance criterion in a specific PRD section:
- The **Source PRD** column must reference an actual PRD file path
- The **Section** column must reference a specific section or acceptance criterion within that PRD
- If a deferral cannot be traced to a concrete acceptance criterion, it is deleted — untraceable deferrals are not real requirements
- When a source PRD is amended or removed, all deferrals referencing it must be reviewed and either re-linked or deleted

### When to add a deferral
- During the acceptance gate (process/acceptance-gate.md), when a criterion cannot be met
- The PRD must acknowledge the gap — you cannot defer something the PRD says is required without amending the PRD
- Document: ID, item description, source PRD + section, specific gate condition
- Update this document immediately — do not batch deferral documentation

### When to check gates
- **At the start of every phase:** run the Phase-Start Gate Review (see above). If a gate condition is now met (because the blocking work was done in a previous phase), the deferred item becomes a requirement of the current phase. It cannot be re-deferred.
- **When implementing infrastructure PRDs:** check if any deferrals are gated on the infrastructure being implemented.

### When to resolve
- When the deferred item is implemented, move it from Active to Resolved with the phase/commit where it was done.

### Gate condition rules
- Must be specific: "Cloud Run migration is implemented" not "when we get around to it"
- Must reference a specific PRD or deliverable that unblocks it
- If the gate condition changes (e.g., the blocking PRD is rescoped), update the gate and record the change in this document
- If the gate will never be met (e.g., feature is cancelled), remove the deferral and amend the source PRD

---

## Acceptance Criteria (for this process)

- [ ] Every deferred acceptance criterion appears in the Active Deferrals table
- [ ] Every deferral has a specific, verifiable gate condition
- [ ] Every deferral traces to a specific acceptance criterion in a specific PRD section (no orphans)
- [ ] Gates are reviewed at the start of every phase (Phase-Start Gate Review)
- [ ] Met gates become current-phase requirements — they cannot be re-deferred
- [ ] Resolved deferrals are tracked with implementation evidence
- [ ] No deferral exists without the source PRD acknowledging the gap
- [ ] This document is updated on every trigger event (add, gate change, phase start, resolve)
