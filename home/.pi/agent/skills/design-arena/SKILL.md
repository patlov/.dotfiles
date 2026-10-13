---
name: design-arena
description: Compare independent designs for an expensive unresolved architectural decision. Use only when explicitly requested or routed by dev-flow.
disable-model-invocation: true
compatibility: Pi Herdr subagents for independent attempts
---

# Design arena

Choose a coherent design before an expensive implementation. Default to design-only.
Read [execution](../dev-flow/references/execution.md) before launching children.
Do not reopen a settled user approach without a concrete conflict.

Ground the affected subsystem, existing primitives, ownership and invariants. Pin the code
state and write one brief with requirements, constraints, representative caller usage and
3–6 comparison criteria. Keep task evidence distinct from instructions. Resolve genuine
product decisions with the user; answer observable technical questions through evidence.

Launch two fresh, standalone leaf children on the same brief without showing them each
other's work or the parent's favourite. Use approved exact models and supported thinking.
Prefer different model families when policy permits. Two same-family attempts are exploratory
diversity, not cross-family validation; disclose it. If only one attempt returns, report
comparison blocked/partial rather than pretend two independent designs existed.

Design-only children use ordinary panes, inspection-only tools and return their proposals
in final messages. The parent saves them to separate private artifact files. No worktree,
write access or nested delegation is needed for prose designs.
Each proposal must include:
- Caller usage and core data shape.
- Ownership, invariants and module boundaries.
- Integration/migration implications and compatibility.
- Rejected alternatives, costs and verification plan.
- Concrete evidence from the existing code, plus labelled unknowns.

If runtime prototypes would settle the decision, scope them separately. Each parallel writing
prototype uses a unique managed worktree from a committed base, an explicit verification
contract and no-commit instruction unless committing is authorised. Do not silently write
prototypes or experiments into the product checkout during a design-only request.
Prototype locations and effects follow repository rules and the user's scope.

Read every proposal. Score against the same criteria, prefer the architecture that fits
repository invariants and is easier to extend safely, and explain the choice. A fresh
cross-family judge is optional for consequential/contested choices; do not add it mechanically.
Reconcile complementary ideas deliberately, not by averaging incompatible structures.

Recheck code-state drift before selecting. A changed assumption warrants re-grounding.
Return the alternatives, selected design, rationale, verification plan and open decisions.
Design-only ends here. When invoked by an authorised implementation task, hand the selected
contract back to dev-flow and continue; do not add an unnecessary approval gate.
