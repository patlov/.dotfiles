---
name: batch-worktree-review
description: Review multiple PRs or remote branches in parallel isolated worktrees and produce one HTML index linking individual reviews. Use for batch PR reviews; use worktree-review for a single PR.
compatibility: Requires the sibling worktree-review and generate-html skills, Git with an origin remote, supervised Pi subagents in Herdr or local Rex (with the pi-terminal-agents wrapper), and Node.js 20 or newer. GitHub PR inputs also require authenticated gh.
---

# Batch Worktree Review

Review-only. Leave the invoking checkout and reviewed branches unchanged. Deliver one HTML index and one evidence-backed code-map report per completed review. Do not post GitHub comments, approve PRs or apply fixes.

Read `../worktree-review/SKILL.md` completely. It is the source of truth for model selection, isolated worktrees, the leaf reviewer assignment, report layout, verification and safe cleanup. This skill replaces its single-input orchestration and final presentation only; the batch-specific rules below take precedence where stated.

## Inputs and scope

Accept an explicit list of two or more PR URLs, PR numbers (`123` or `#123`), or remote branch names, plus optional `fast` / `--fast` in any order. Launch one reviewer per unique eligible target, all concurrently; there is no skill-imposed concurrency cap or `--jobs` option. Numeric tokens are PR numbers; a numeric branch can be supplied as `refs/heads/123`. Strip `refs/heads/` before passing a branch to the helper. Reject unknown flags before creating worktrees. With one unique target, use the single-review skill instead. With no targets, ask for the list; do not enumerate all open PRs implicitly.

Examples:

```text
/skill:batch-worktree-review 123 456 789
/skill:batch-worktree-review --fast feature/catalogue fix/upload
/skill:batch-worktree-review https://github.com/owner/repo/pull/123 456
```

Resolve the invoking repository's exact `origin` identity before resolving PRs. Use read-only `gh` queries with an explicit repository to obtain each PR's URL, number, title, base repository/branch, head repository/branch and head SHA. Bare PR numbers belong to that repository. Check URL repository identity rather than resolving its number against the current repository.

This version uses the single-review helper's `origin/main` comparison. Mark PRs targeting another base, fork heads, and PR URLs belonging to another repository as unsupported; do not silently substitute an origin branch or review a stacked PR against the wrong base. Branch inputs explicitly mean comparison against `origin/main`. A lookup/authentication failure is a failed target, not permission to guess. Continue with other resolvable targets and retain an entry for every requested target.

Resolve branch inputs to exact head SHAs with `git ls-remote --heads origin "refs/heads/<branch>"`, checking for one exact ref match; do not use local branches or fuzzy matches. Validate branch names before constructing refs, and quote user-derived shell arguments.

Deduplicate canonical repository + head branch + resolved head SHA, preserving aliases and input order. Do not review the same snapshot twice. Confirm the selected exact model is authenticated using the single-review skill's mode table before any worktree creation. An unavailable mode stops the batch, with no model fallback.

## Prepare snapshots serially

Resolve the existing helper at `../worktree-review/scripts/worktree-review.sh`; do not copy it or create a second lifecycle implementation. Run it from the invoking repository, not from a review worktree.

Create a unique batch artefact directory outside all repositories under `~/.pi/agent/generated-html/`. Save a `batch.json` manifest there before preparation and update it after each lifecycle transition. It is local generated state, not a tracked file. Record:

- batch identity, invoking repository, mode/model/thinking and planned reviewer count;
- each requested input and canonical identity, aliases and lookup errors;
- each target's status (`queued`, `prepared`, `running`, `complete`, `failed`, `unsupported` or `cancelled`), worktree path, target/base/merge-base SHAs and child name/ID when available;
- per-target verdict, blocker/major/minor counts (null until verified), report/evidence paths, validation gaps and cleanup outcome;
- derived readiness group, rank (null when unknown), concise evidence-backed reason and any known merge prerequisite; preserve original input position for stable tie-breaking;
- final index path and whether its one desktop-opening attempt has been recorded.

Prepare every eligible target **sequentially before launching any reviewer**. The helper uses shared `FETCH_HEAD`, updates `origin/main` and prunes leftovers, so parallel preparation can corrupt snapshot selection or race with cleanup. Capture `WORKTREE_PATH` and `TARGET_COMMIT` immediately for each successful prepare. If a target's fetched SHA differs from its resolved head SHA, mark it failed with a moved-head explanation and retain its worktree through `cleanup-failed`; do not silently change the promised snapshot.

After all prepares, resolve `origin/main` once to a common `BASE_COMMIT`, and compute each worktree's merge-base with that SHA. Save these pins in the manifest. Do not fetch, prepare, prune or update refs again while reviewers are running. If a prepare or pinning step fails, record the exact safe diagnostic, use `cleanup-failed` for any known worktree that will not be reviewed, and continue with independent targets.

## Dispatch all leaf reviews concurrently

Use the selected supervised terminal backend for every child. Rex uses one tab per reviewer by default; `../rex-review/SKILL.md` adds dedicated-session routing without changing this batch methodology. If a Rex session is selected, record its full ID in the manifest. The existing helper supplies worktrees as `cwd` on both backends; do not request host-managed worktree provisioning or launch unmanaged Pi processes.

Use one bare, fresh-session reviewer per prepared target. Follow the single-review skill's launch contract exactly: explicit model and thinking, `fork: false`, review-only system prompt and tool allowlist, `cwd` pointing to the helper-created worktree, no named `agent`, and no managed `worktree` argument. Use unique names such as `batch123-review` or `batch-feature-catalogue-review-2` and print `name | bare | review | model | worktree` for each launch group.

Give each child one bounded outcome, including canonical PR/branch identity, expected target SHA, **common base SHA**, merge-base, worktree path, its own output directory and the absolute single-review skill path. Require the child to read and apply only that skill's **Reviewer assignment** and **HTML layout** sections. Add these batch overrides explicitly:

- Verify HEAD and the supplied base/merge-base pins. Review exactly `BASE_COMMIT...TARGET_COMMIT`, using the supplied immutable SHAs instead of resolving or fetching `origin/main` again.
- Write its HTML and evidence only in its assigned directory outside the worktree. No repository edits, commits, pushes, merges, deployments, GitHub comments, further agents, cleanup or desktop opening.
- Return the complete single-review handoff, including pins, verdict, accurate severity counts, findings, checks/gaps and absolute artefact paths. A partial or failed review must say so; it is not a clean verdict.

Launch one child for every prepared target without waiting for earlier reviews to finish, then end the turn. Two eligible PRs get two agents; ten get ten. Duplicate snapshots share one reviewer, and failed or unsupported targets get none. If the host or provider rejects a launch, record that target as failed with the actual diagnostic; do not silently impose a smaller queue. Results arrive automatically; do not poll, sleep or read session logs to discover completion. On each delivered result, verify and finalise that target and update the manifest. Do not retry failed reviews automatically or cancel siblings because one failed.

On an explicit stop request, stop launching further children and use `subagent_cancel` for active ordinary children. Wait for delivered cancellation/termination evidence before lifecycle handling; a requested or unconfirmed cancellation is not an exited reviewer. Mark unlaunched targets cancelled and run `cleanup-failed` on their prepared worktrees. Retain active markers for children whose termination remains unconfirmed. On a resumed parent turn, consult the manifest and delivered results before acting; do not duplicate launches, cleanup or browser opening based on an absent transcript entry.

## Verify each result and handle lifecycle

The parent inspects each report and its evidence using the single-review skill's verification rules, including scope pins, complete diff inventory, findings/count agreement and navigation targets. Null/unknown counts for failed reviews stay unknown, never zero. A successful tool result alone is not a verified review.

For a verified complete review, invoke the existing helper's `cleanup-success` from the invoking repository and record removed/already removed/retained dirty/error accurately. A complete review may have validation gaps or findings; those do not make it an incomplete deliverable. For a failed, cancelled or incomplete review with confirmed child termination, use `cleanup-failed` and record the retained path. Never force removal or remove worktrees belonging to other runs. Cleanup errors do not erase an otherwise complete review.

**Batch opening override:** do not run the single-review workflow's desktop-opening step for individual reports. Only the final batch index is opened, once, by the parent.

## Build the final index

Once all targets are terminal and lifecycle handling is recorded (or explicitly blocked by unconfirmed termination), read `../generate-html/SKILL.md` and use its renderer to create a self-contained batch index in the artefact area. Skip its opening step until verification below. Retain the Markdown source and manifest. Index content:

1. **Coverage:** requested inputs, unique targets, completed reviews and failed/unsupported/cancelled counts. Label the batch partial if any requested target lacks a verified review. Report completed-review severity totals separately; a partial batch is never an all-clear.
2. **Merge-readiness ranking:** one entry per unique reviewed target, sorted using the readiness rules below rather than input order. Show its rank, readiness label, PR/title or branch, a short reason explaining its position, blocker/major/minor counts, relevant validation status and a link to its detailed report. Keep aliases, short pinned head/base SHAs and cleanup outcome in expandable detail. Put unknown-readiness targets in a clearly separated, unranked group with the failure, missing validation or other prerequisite stated; include retained worktree paths when applicable. Do not link incomplete pages as finished reviews.
3. **Needs attention:** brief blocker/major summaries grouped by PR, linking to the corresponding report/finding. Do not merge distinct findings or imply an interaction was tested. Preserve paste-ready PR comments in the individual reports rather than flooding the batch summary.
4. **Scope and gaps:** common base SHA, model/mode, validation gaps, cleanup failures/retained paths and links to the manifest and supporting evidence. Separate possible cross-PR overlap from confirmed findings. These are independent snapshot reviews, not a combined merge/integration test. The ranking is based on review readiness, not a dependency-aware merge sequence or proof of GitHub mergeability.

### Readiness rules

Derive readiness from the verified reports; do not ask reviewers for a subjective numeric cleanliness score or infer effort from diff size. Sort these groups first to last:

1. **Ready from review:** a complete, verified review with an APPROVE verdict, zero blockers/majors/minors, no known failing required checks and no material validation gap or known unresolved prerequisite. Optional suggestions alone do not lower this group. This means no retained review findings, not a guarantee of defect-free code.
2. **Minor fixes only:** a complete, verified review with no blockers or majors and at least one minor, with no material validation/check/prerequisite gate. State the remaining change briefly; minors are not called blockers.
3. **Major fixes needed:** at least one major and no blocker. Show material validation gaps or known prerequisites alongside the findings; do not imply this is a minor cleanup.
4. **Blocked by review:** at least one blocker. Do not dilute that label because another PR has more lower-severity findings.

Failed, cancelled, unsupported, incomplete or unverified reviews have **Readiness unknown**, with no numerical rank. A report with no blocker/major finding also belongs here when a failing required check, material unvalidated risk, known unresolved prerequisite or unexplained non-approval verdict prevents a ready/minor-only judgement. Keep known finding counts visible rather than replacing them with zeros. Reconcile contradictions between verdict, findings and counts before publishing; do not invent findings to make a rank fit.

Within a ranked group, sort by fewer blockers, then fewer majors, then fewer minors; preserve original input order for exact ties. Assign consecutive ranks only to the ranked entries and persist the derived group, rank and specific reason in the manifest. Routine limitations such as no live external-service run do not automatically make readiness unknown: explain whether a gap leaves a material risk unchecked for this change. A reason should be concrete (“No findings; focused regression tests passed” or “One minor: reuse the shared loader”), not “clean architecture” without evidence.

Do not silently imply draft status, required approvals, CI status, merge conflicts or branch freshness were checked. If GitHub readiness is not separately inspected, label it **GitHub mergeability not checked**. Any separately obtained GitHub result must match the reviewed head SHA, with its source/time recorded; it does not override code-review findings. Surface known dependencies as prerequisites, not an inferred merge order. Worktree cleanup failures are operational notes, not evidence that the PR is harder to merge.

Use encoded local links for generated paths, escape PR titles/branch names as text, and keep assets inline without network dependencies. Verify every report/evidence link exists, pins and counts agree with inspected evidence and the manifest, each requested input is accounted for, ranked groups and tie-breaks match their evidence, and incomplete or validation-gated targets cannot appear ready. Check the HTML title, placeholders and navigation. Do not claim visual verification unless performed.

Record the index-opening attempt in the manifest before invoking `open` on macOS or `xdg-open` on Linux. Open only this verified index, even when it transparently reports a partial batch; incomplete individual reports remain unopened. With no desktop or a failed opening attempt, return the absolute path and `file://` URL without retries. Do not build/open an empty success page when preflight stopped the batch.

Finish with a concise coverage/verdict summary, completed-review blocker/major/minor totals, failed or unsupported targets, validation/cleanup gaps, and the absolute index path plus `file://` URL. Do not offer to apply fixes.
