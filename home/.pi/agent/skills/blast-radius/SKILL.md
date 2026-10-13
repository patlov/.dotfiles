---
name: blast-radius
description: Check consequences beyond a diff and prove the key safety assumptions. Use only when explicitly requested or routed by dev-flow for a risky shared change.
disable-model-invocation: true
compatibility: Git and Node.js 22+ for the bundled snapshot helper
---

# Blast radius

Inspect a change and demonstrate the assumptions that make it safe. Default to report-only:
no product fixes, commits or publication. Read [execution](../dev-flow/references/execution.md)
and [verification](../dev-flow/references/verification.md) before delegation or runtime checks.

## Pin the scope

Resolve the user's files/range/branch and whether staged, unstaged or untracked work is included.
For an unspecified current change, use staged work when present, otherwise working changes,
otherwise the branch range against its confirmed comparison base. Do not guess a trunk branch.
If the helper's working scope includes unrelated layers, use Git's read-only staged/unstaged
diffs separately or materialise selected before/after excerpts instead; state the narrower scope.
A non-Git target needs equivalent before/after evidence; no fabricated SHA.

Inventory changes before capture and select relevant untracked files explicitly. Run the helper
at [snapshot-change.mjs](../dev-flow/scripts/snapshot-change.mjs) using
`node <script> --repo <root> --base <commit-or-ref> --scope <working|branch|combined> --out <private-directory>`.
Use `--path <repo-relative-path>` repeatedly to narrow the tracked/untracked scope and
`--include-untracked <file>` repeatedly only for files whose contents are needed and safe to capture.
For working-only evidence, base is current HEAD. For a branch, resolve the intended common ancestor
explicitly when that is the requested comparison; the helper compares the exact base to head,
not an implicit merge-base. Use `--help` for the complete interface and limitations.

The helper stores full diffs, inventory, untracked hashes and a fingerprint outside the checkout.
It does not scan for secrets or prove an environment safe. Keep raw evidence private.
Untracked inventory without content is a coverage gap when that file matters. Binary payloads
need actual artifact inspection; a binary patch alone is not behavioural proof.
Before child launch and final synthesis run `node <script> --check <snapshot.json>`.
Drift invalidates affected conclusions; re-pin and recheck, never silently reuse the verdict.

## Find and prove the assumptions

Trace beyond direct symbol callers: persisted documents, wire formats, schemas, permissions,
tenant resolution, retry/concurrency ordering, jobs, flags and downstream consumers.
Read pinned dependency versions/source when library behaviour is the safety assumption.

Focus on the one or few invariants that carry the risk. For each, state:
- What must be true and the concrete failure if it is false.
- A real code/data-flow trace, not a list of hypothetical callers.
- The cheapest safe executable check that can falsify it.
- What actually ran, its result and any missing precondition.

Reproductions may create caches/artifacts or mutate application state. Permit only effects
already authorised by the task/repository; put temporary probes outside the checkout where possible.
For a read-only request with no safe execution path, provide trace-backed evidence and mark the
runtime claim unproven. Do not turn "review" into fixture creation on shared data.

For a wide change, delegate independent inspections using the shared execution contract.
A single-model inspection is valid but must not be labelled independent review.
Disprove weak findings as well as confirm real ones. Agreement is provenance, not proof.

## Result

Return the pinned scope and:
- **Safety assumptions:** verified, failed or unproven, with trace/proof pointers.
- **Risks:** concrete consequence, location, preconditions and required action.
- **Cleared:** important suspected risks actually checked and ruled out.
- **Coverage gaps:** missing content, unavailable checks, drift or failed children.
- **Before merging:** smallest remaining check or fix, not permission to merge.

A serious unresolved assumption or coverage gap means incomplete verification, not a pass.
