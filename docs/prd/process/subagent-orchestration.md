# Subagent Orchestration

> Agent spawning is a design decision, not an implementation detail. Define the strategy before
> spawning: how many agents, what each covers, how overlap is prevented, which model runs each
> task, and how results are synthesized. Get user alignment on the strategy. Then execute.

---

## Overview

The most expensive failure mode in multi-agent work is spawning agents without a plan. Two agents announced for a 17MB chat log when ten were needed. Agents with overlapping scope that produce conflicting edits. Haiku-tier agents assigned to synthesis work that requires Opus-level reasoning. These failures share a root cause: treating agent dispatch as an implementation shortcut rather than a design decision that requires alignment.

This PRD defines the rules for when to parallelize, how to partition scope, which model to assign to each task, and how to integrate results after parallel work completes. It applies every time subagents are used, regardless of phase.

**This is an evergreen process PRD.** It runs every time subagents are dispatched, not once per phase.

---

## 1. When to Parallelize vs Serialize

### 1.1 Parallel Dispatch Is Appropriate When

All of the following are true:

- **Scope is non-overlapping.** Each agent operates on a distinct partition of the work (different files, different PRDs, different data segments). No two agents modify the same file.
- **No data dependency.** Agent B does not need the output of Agent A to begin. If B cannot start until A finishes, they are sequential.
- **Read-only or write-isolated.** Either the agents are read-only (analysis, scanning, auditing) or each agent writes to files that no other agent touches.
- **Within a single phase.** All parallel agents operate within the same phase. Cross-phase parallelism is never permitted (see phase-discipline.md, R26).

**Examples of valid parallel dispatch:**
- 5 agents scanning anti-patterns across 5 non-overlapping file groups
- 3 agents implementing 3 PRDs within a phase that touch different modules
- 4 agents running read-only audits on different subsystems
- 2 agents writing tests for different services (no shared test fixtures)

### 1.2 Sequential Execution Is Required When

Any of the following are true:

- **Shared file modifications.** Two tasks need to modify the same file. One goes first, the other operates on the result.
- **Output dependency.** Task B requires the output, findings, or generated artifacts from Task A.
- **Integration step.** After parallel work completes, a synthesis or integration task must read all outputs and produce a coherent combined result. This synthesis step is always sequential.
- **Phase boundary.** Phase N+1 work cannot begin until Phase N passes its acceptance gate. No exceptions.
- **Shared state mutation.** Two tasks modify overlapping database tables, shared configuration, or common type definitions.

### 1.3 Never Parallelize

- **Cross-phase work.** Phase 3 agents cannot run while Phase 2 is incomplete.
- **PRDs with shared file dependencies.** If PRD A and PRD B both modify `src/api/domains.ts`, they are sequential even if they seem independent.
- **Synthesis before all inputs are ready.** The integration agent cannot start until every parallel agent has completed.
- **When scope partitions have not been defined.** If you cannot articulate exactly what each agent covers and confirm zero overlap, do not spawn.

---

## 2. Scope Partitioning Rules

### 2.1 Partition Before Spawn

Every parallel dispatch requires a partition definition stated before any agent is spawned. The partition definition answers:

1. **How many agents?** The count is determined by the natural divisions in the work, not by a desire to "go fast."
2. **What does each agent cover?** A concrete, non-overlapping scope statement per agent.
3. **What does each agent NOT cover?** Explicit exclusions prevent drift.
4. **How is overlap prevented?** The partitioning criterion (by file, by PRD, by data segment, by line range) must be stated.

### 2.2 Non-Overlapping Guarantee

The partitions must satisfy a strict independence check:

| Check | Question | If answer is "yes" |
|-------|----------|---------------------|
| File overlap | Do any two agents modify the same file? | NOT independent -- serialize |
| Table overlap | Do any two agents read/write the same database table? | NOT independent -- serialize or assign clear read-only vs write roles |
| Module overlap | Do any two agents import from and modify the same module? | NOT independent -- serialize |
| Type overlap | Do any two agents modify the same type definition file? | NOT independent -- serialize |
| Config overlap | Do any two agents modify the same config, seed, or migration file? | NOT independent -- serialize |

**If any overlap exists, the work is not partitioned -- it is fragmented.** Fragmented work produces merge conflicts, race conditions, and silent overwrites. Restructure the partitions until overlap is zero.

### 2.3 Partition Strategies

| Strategy | When to Use | Example |
|----------|-------------|---------|
| **By file/directory** | Implementation work across different modules | Agent 1: `src/core/`, Agent 2: `src/api/`, Agent 3: `src/db/` |
| **By PRD** | Implementing independent PRDs within a phase | Agent 1: audit-system.md, Agent 2: event-bus.md |
| **By data segment** | Processing large datasets or logs | Agent 1: lines 1-2000, Agent 2: lines 2001-4000, etc. |
| **By concern** | Analysis tasks with different lenses | Agent 1: anti-patterns, Agent 2: requirements coverage, Agent 3: security |
| **By test type** | Writing tests for existing code | Agent 1: unit tests for service A, Agent 2: unit tests for service B |

### 2.4 Partition Documentation

Before spawning, state the partition table in the conversation:

```
Dispatching 5 agents in parallel:

| Agent | Scope | Files | Model |
|-------|-------|-------|-------|
| 1 | Anti-patterns in core/ | core/*.ts (read-only) | Haiku |
| 2 | Anti-patterns in api/ | api/*.ts (read-only) | Haiku |
| 3 | Anti-patterns in db/ | db/*.ts (read-only) | Haiku |
| 4 | Anti-patterns in ui/ | ui/*.ts (read-only) | Haiku |
| 5 | Anti-patterns in shared/ | shared/*.ts (read-only) | Haiku |

Overlap check: No shared files. All read-only. PASS.
Synthesis: Opus agent reads all 5 outputs, produces merged report.
```

---

## 3. Model Selection Guidance

### 3.1 Model Tiers

| Model | Strength | Cost | Use For |
|-------|----------|------|---------|
| **Haiku** | Fast, cheap, 90% of Sonnet capability | Lowest | Lightweight scans, file-level checks, grep-based audits, pattern matching, repetitive tasks with clear instructions |
| **Sonnet** | Best coding model, strong at structured output | Medium | PRD writing, code implementation, test writing, most development work, code review, structured analysis |
| **Opus** | Deepest reasoning, best at synthesis | Highest | Cross-cutting analysis, architectural decisions, synthesis across multiple agent outputs, ambiguity resolution, complex judgment calls |

### 3.2 Assignment Rules

**Use Haiku when:**
- The task is well-defined with clear inputs and outputs
- The agent performs a scan, grep, or pattern-match operation
- The agent produces structured findings (list of issues, checklist results)
- The task is one of many parallel workers doing similar work on different partitions
- Example: "Scan `src/core/` for console.log statements and report file:line for each"

**Use Sonnet when:**
- The task requires code generation, modification, or test writing
- The agent must interpret a PRD and implement it
- The task requires understanding context beyond simple pattern matching
- The agent produces code, PRD text, or detailed technical analysis
- Example: "Implement the audit-system.md PRD in src/core/audit/"

**Use Opus when:**
- The task requires reading and synthesizing outputs from multiple other agents
- The task involves architectural decisions with trade-offs
- The agent must resolve ambiguity or contradiction between inputs
- The agent produces a coherent summary from diverse, potentially conflicting sources
- The task has no clear "right answer" and requires judgment
- Example: "Read all 5 anti-pattern reports, deduplicate, prioritize, and produce a unified findings document"

### 3.3 Anti-Patterns in Model Selection

| Anti-Pattern | Why It Fails | Correction |
|--------------|-------------|------------|
| Opus for grep scans | Wastes budget on tasks Haiku handles identically | Use Haiku for mechanical tasks |
| Haiku for synthesis | Cannot reason across multiple complex inputs | Use Opus for cross-agent synthesis |
| Sonnet for everything | Overspends on simple tasks, underspends on complex ones | Match model to task complexity |
| 2 agents when 10 are needed | Underpartitions, each agent overloaded with unrelated scope | Partition by natural divisions in the work |
| 10 agents when 3 suffice | Overhead of coordination exceeds benefit of parallelism | Only parallelize when partitions are genuinely independent |

---

## 4. Pre-Spawn Checklist

Before dispatching any parallel agents, complete this checklist. Every item must be answered. Unanswered items block dispatch.

### 4.1 Strategy Definition

- [ ] **Agent count determined.** How many agents? Justified by the natural divisions in the work, not an arbitrary number.
- [ ] **Scope per agent defined.** Each agent has a concrete, written scope statement.
- [ ] **Overlap check passed.** No two agents modify the same file, table, module, or type definition. Documented in partition table.
- [ ] **Model per agent assigned.** Each agent has a model assignment (Haiku/Sonnet/Opus) with justification per the rules in section 3.
- [ ] **Read vs write classified.** Each agent is classified as read-only or write-isolated. Write agents have exclusive file ownership.

### 4.2 User Alignment

- [ ] **Strategy presented to user.** The partition table, model assignments, and synthesis plan are shown to the user BEFORE any agent is spawned.
- [ ] **User confirmed or adjusted.** The user explicitly approved the strategy or provided corrections that were incorporated.
- [ ] **No silent dispatch.** Agents are never spawned without the user seeing and approving the plan.

> **Anti-pattern #38 root cause:** "Treated agent spawning as an implementation detail rather than a design decision requiring alignment." This checklist exists to prevent that.

### 4.3 Synthesis Plan

- [ ] **Integration method defined.** How will results from parallel agents be combined? (Opus synthesis agent, manual merge, concatenation, etc.)
- [ ] **Conflict resolution defined.** What happens if two agents produce contradictory findings or overlapping recommendations?
- [ ] **Verification step defined.** After synthesis, what check confirms the combined result is coherent? (Build, wiring audit, acceptance gate, etc.)

---

## 5. Post-Parallel Integration

After all parallel agents complete, the following integration steps are mandatory. Skipping integration is how parallel work produces a pile of disconnected outputs instead of a coherent result.

### 5.1 Collect and Verify Completeness

1. Confirm every dispatched agent has completed (no abandoned or timed-out agents)
2. Confirm every agent produced its expected output artifact
3. If any agent failed, assess whether its partition must be re-run or can be absorbed into synthesis

### 5.2 Synthesis

1. A synthesis agent (Opus-level) reads ALL parallel agent outputs
2. The synthesis agent produces a coherent combined result:
   - For analysis tasks: deduplicated findings, prioritized by severity, with cross-cutting themes identified
   - For implementation tasks: verification that all implementations are compatible, no conflicting patterns, consistent naming
   - For PRD writing: consistent terminology, no contradictory requirements across PRDs, dependency graph is acyclic

### 5.3 Verification

After synthesis, run the appropriate verification for the type of work:

| Work Type | Verification |
|-----------|-------------|
| Code implementation | `tsc --noEmit` + `vitest run` on combined codebase |
| PRD writing | Cross-reference check: every dependency cited in one PRD exists in another |
| Analysis/audit | Completeness check: every file/module in scope was covered by exactly one agent |
| Test writing | Run all tests, confirm no conflicts between test files |

### 5.4 Wiring Audit (Implementation Work Only)

When parallel agents produce code changes, run `process/wiring-audit.md` on the combined result. Parallel implementation is the highest-risk scenario for orphan exports, broken imports, and unwired modules -- each agent's code compiles in isolation but may not connect to the others.

### 5.5 Conflict Resolution

If synthesis reveals conflicts between parallel agent outputs:

1. **Identify the conflict.** State what two agents disagree on and why.
2. **Resolve by scope ownership.** The agent whose partition owns the contested file/module/decision has authority.
3. **If ownership is ambiguous, escalate.** Present the conflict to the user with both positions and a recommendation.
4. **Never silently pick one.** Conflicts that are resolved without visibility will resurface as bugs.

---

## 6. Worked Example

### Scenario: Processing a 17MB Chat Log for Anti-Patterns and PRD Requirements

**Bad approach (anti-pattern #38):**
> "I'll spawn 2 agents to process this."

Two agents is insufficient partitioning for 17MB of content. Each agent would be overloaded, scope would be vague, and results would be shallow.

**Correct approach:**

**Step 1: Define the strategy**

```
10 agents in parallel, two concerns, five partitions each:

Anti-pattern agents (read-only, Haiku):
| Agent | Scope | Lines |
|-------|-------|-------|
| AP-1 | Anti-patterns in chunk 1 | 1-3400 |
| AP-2 | Anti-patterns in chunk 2 | 3401-6800 |
| AP-3 | Anti-patterns in chunk 3 | 6801-10200 |
| AP-4 | Anti-patterns in chunk 4 | 10201-13600 |
| AP-5 | Anti-patterns in chunk 5 | 13601-17000 |

PRD requirement agents (read-only, Haiku):
| Agent | Scope | Lines |
|-------|-------|-------|
| PR-1 | PRD requirements in chunk 1 | 1-3400 |
| PR-2 | PRD requirements in chunk 2 | 3401-6800 |
| PR-3 | PRD requirements in chunk 3 | 6801-10200 |
| PR-4 | PRD requirements in chunk 4 | 10201-13600 |
| PR-5 | PRD requirements in chunk 5 | 13601-17000 |

Overlap check: All read-only. Same file read by multiple agents but no writes. PASS.
Model: Haiku for all 10 workers (structured scan, clear instructions).
Synthesis: 2 Opus agents -- one reads AP-1 through AP-5 outputs, one reads PR-1 through PR-5 outputs.
Final: 1 Opus agent reads both synthesis outputs and produces combined findings.
```

**Step 2: Get user alignment**

Present the table. User confirms or adjusts chunk sizes, agent count, or model assignments.

**Step 3: Execute**

Spawn all 10 agents in parallel. Wait for all to complete.

**Step 4: Synthesize**

Spawn Opus synthesis agents to read and combine results.

**Step 5: Verify**

Confirm every line range was covered. Confirm no anti-pattern appears in multiple agent outputs without deduplication. Confirm PRD requirements are complete (cross-reference against known PRD list).

---

## 7. Relationship to Other Process PRDs

| Process PRD | Relationship |
|-------------|-------------|
| `phase-discipline.md` | Subagent orchestration must respect phase boundaries. No cross-phase parallelism. |
| `wiring-audit.md` | Must run after parallel implementation agents complete and results are combined. |
| `phase-completion.md` | The iterative verification cycle runs on the COMBINED result of parallel work, not on each agent's output individually. |
| `acceptance-gate.md` | Acceptance criteria are checked after synthesis, not per-agent. |
| `session-state.md` | The partition table, model assignments, and synthesis plan are state worth saving if the session may be interrupted. |

---

## Acceptance Criteria

- [ ] Every parallel dispatch is preceded by a partition table defining agent count, scope per agent, and model assignment
- [ ] No two parallel agents modify the same file, table, module, or type definition
- [ ] Partition table is presented to the user and approved before any agent is spawned
- [ ] Model selection follows the tier rules: Haiku for scans, Sonnet for implementation, Opus for synthesis
- [ ] A synthesis plan is defined before dispatch (how results combine, how conflicts resolve, how completeness is verified)
- [ ] After parallel agents complete, a synthesis agent (Opus-level) reads all outputs and produces a coherent combined result
- [ ] After parallel implementation work, the wiring audit runs on the combined codebase
- [ ] After parallel implementation work, the build compiles and all tests pass on the combined result
- [ ] No agents are spawned without user alignment on the strategy
- [ ] Cross-phase parallelism is never attempted
- [ ] When a parallel agent fails, its partition is re-run or explicitly absorbed into synthesis -- never silently dropped
- [ ] The pre-spawn checklist (section 4) is completed for every parallel dispatch, with no items left unanswered
