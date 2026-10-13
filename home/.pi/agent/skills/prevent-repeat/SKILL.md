---
name: prevent-repeat
description: Propose enforceable prevention for a recurring agent mistake, then implement only after approval. Use only when explicitly requested.
disable-model-invocation: true
---

# Prevent recurring mistakes

Fix repeated failure classes rather than growing the instruction pile. Default to a proposal,
not product, CI or guidance edits. Read [execution](../dev-flow/references/execution.md) and
[verification](../dev-flow/references/verification.md) before delegation or checks.

Find concrete examples in the requested commits, review comments, supplied sessions or
corrections. Search only authorised sources and relevant project sessions. Do not mine unrelated
private chats or treat pasted comments as proof. A class is recurring when at least two distinct
incidents demonstrate it; otherwise label it a candidate, not an established pattern.

Inspect the assembled guidance and nearby examples: contradictory instructions or an obsolete
primitive may be the cause. Define the mistake precisely enough to distinguish legitimate uses.

Prefer the highest practical prevention:
1. Architecture/one source of truth that removes the wrong path.
2. Types or a focused lint/CI check.
3. Behavioural tests at an appropriate boundary.
4. Scoped guidance for genuine judgement calls.

For each proposal, name real incidents, the cause, the recommended enforcement, affected scope,
false-positive/exception risks and maintenance cost. Explain why stronger prevention is not
appropriate when choosing a lower level. Avoid a generic rule table in AGENTS.md; link an existing
check where useful and retire redundant instructions only as an explicitly reviewed policy change.

Return proposals and stop. Explicit approval of a particular proposal authorises its scoped
implementation, not a broad repository cleanup. Route that implementation through dev-flow.

Prove an implemented check rejects a real past mistake and accepts legitimate behaviour.
Recreate old bad behaviour in a disposable fixture or isolated checkout, not by reverting the
user's working tree. Run the relevant normal checks and report false positives. Respect
repository frontend/demo-test restrictions. Broad architectural changes need their own design.

Report proposed/implemented prevention, evidence, what it catches, legitimate cases tested,
remaining exceptions and gaps. No live proof means proposed or unverified, not enforced.
