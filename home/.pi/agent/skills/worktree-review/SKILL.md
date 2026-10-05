---
name: worktree-review
description: Reviews a remote Git branch in a fresh isolated worktree, produces a visual HTML code map explaining changes and review findings, then safely removes the clean worktree. Supports a fast GLM reviewer mode. Use when the user says "worktree review <branch>", asks to review a branch without touching the current checkout, or invokes /skill:worktree-review.
compatibility: Requires Git, a configured origin remote, and Pi subagents.
---

# Worktree Review

Review a remote branch in an isolated worktree without changing the user's current checkout. One argument must be the remote branch name. If it is missing, ask for it; never guess.

An optional `fast` flag selects the fast reviewer. Accept `fast` or `--fast`, either before or after the branch name. Examples:

```text
/skill:worktree-review fast fix/my-branch
/skill:worktree-review fix/my-branch --fast
```

Reject any other extra arguments instead of treating them as part of the branch name.

This workflow is review-only. Do not edit, commit, push, merge, or rebase the reviewed branch.

The HTML deliverable is one **visual code-map walkthrough**, not a separate architecture-review report. Keep the evidence-based review, but explain the changed system first and place findings in the relevant flows.

## Lifecycle policy

- Create a unique detached worktree for every run under `~/.pi/agent/worktrees/reviews/<repo-key>/` (or the equivalent `PI_CODING_AGENT_DIR` location), outside the repository.
- Before creating it, prune clean worktrees left by earlier runs of this skill for the same repository.
- Never prune a worktree with an active marker less than one day old.
- Never remove a dirty worktree.
- After a completed review, remove the worktree only when it is clean.
- After a failed or interrupted review, retain the worktree; a later invocation may prune it if it remains clean.
- Never use `--force` for cleanup.

The helper script enforces these rules. Resolve paths relative to this `SKILL.md`:

```bash
HELPER="<skill-directory>/scripts/worktree-review.sh"
```

## 1. Prepare the worktree

Parse and validate the arguments before creating anything. Confirm that the selected review model is available and authenticated; if not, report that the selected mode is unavailable and stop before preparing a worktree.

Run from the repository where the user invoked the skill:

```bash
"$HELPER" prepare "<remote-branch>"
```

The command:

1. validates the branch name;
2. prunes eligible leftovers from this skill only;
3. fetches the exact branch and `origin/main`;
4. creates a unique detached worktree outside the repository at the fetched commit; and
5. prints `WORKTREE_PATH=...`, `TARGET_COMMIT=...`, and `BASE_REF=origin/main`.

Capture `WORKTREE_PATH`. If fetching fails, report the exact Git error and stop. Do not fall back to a similarly named branch or a local branch.

Detached checkout is intentional: a review must not claim, move, or collide with the user's local branch.

## 2. Launch the Pi reviewer

Select the reviewer mode from the parsed arguments:

- **Default:** use exactly `openai-codex/gpt-6.1-sol` with `thinking: "xhigh"` (extra high). Confirm that this exact model is authenticated before preparing the worktree; if unavailable, report that default review mode is unavailable and stop rather than silently changing models.
- **Fast (`fast` or `--fast`):** use exactly `openrouter/z-ai/glm-5.3-flash` with `thinking: "high"`. If that exact model is not authenticated, report that fast mode is unavailable and stop; do not silently fall back to another model.

Never use an Anthropic/Claude model in either mode.

Use the `subagent` tool with:

- `agent: "reviewer"`;
- `cwd: WORKTREE_PATH`;
- no managed `worktree` argument, because the helper already created the worktree;
- a stable name ending in `-review`, derived from a short branch slug;
- the exact `model` and `thinking` selected above;
- `bashGuardDisabled: true` explicitly for this autonomous review, so the Herdr launcher supplies Pi's `--bash-guard-disabled` flag from process startup and the reviewer cannot stall on interactive confirmations; fresh and resumed launches otherwise keep bash-guard enabled by default. Pass the same explicit opt-out when resuming this review—do not ask the child to run `/bash-guard` after launch. If the loaded tool does not expose `bashGuardDisabled`, stop and ask the user to reload the updated extension before launching.

Prompt the child to:

1. review the exact range `origin/main...HEAD` for the named branch;
2. read all repository instructions that govern changed files;
3. read `~/.pi/agent/skills/architecture-review/SKILL.md` completely and apply its scope, baseline, review, validation and severity methodology (sections 1–5); replace its section 6 report format with the code-map contract below, rather than generating two HTML pages;
4. remain read-only and make no implementation changes;
5. run the narrowest relevant validation without modifying the reviewed checkout; use a pinned temporary archive outside it when checks generate files;
6. read and follow `~/.pi/agent/skills/generate-html/SKILL.md`, then generate the code-map HTML outside the repository using the contract below; and
7. return the verdict, accurate blocker/major/minor counts, validation performed and gaps, absolute HTML path, and pinned repository/head/base/merge-base identity.

### Code-map HTML contract

Create a self-contained, browsable explanation for someone trying to understand the branch, not just a list of defects. Produce **one HTML page** with:

1. **Executive summary and before/after:** what the branch enables, what remains unchanged, rollout gates and scope; include the review verdict/counts without making findings the page's main structure.
2. **Clickable visual architecture map:** entry points, changed layers, key components/services and dependency direction. Label blocks **NEW**, **CHANGED** or **REUSED** based on the diff. Link blocks to the corresponding explanation sections. Use inline SVG or HTML/CSS cards and arrows, not only a fenced ASCII diagram.
3. **Concrete code/control/data flows:** trace the feature's relevant loading, filtering, rendering, state, persistence and action paths. Cite functions, file paths and snapshot line ranges. Follow indirect helpers/managers/tasks accurately; omit categories that do not apply rather than inventing them.
4. **Contracts and ownership:** explain payload/response changes, local versus persisted state, identity keys, permission checks, domain side effects, partial failures, compatibility and important limits. Keep presentation metadata distinct from server authorisation.
5. **Shared changes:** show which reusable models, hooks, inputs, queries or primitives change and what other callers are affected. Do not imply every changed file is feature-local.
6. **Review risks on the map:** place each blocker/major at the flow or ownership boundary that causes it. Include the full explanation, impact, evidence, changed/context distinction, PR anchor, paste-ready comment and smallest safe correction required below. Label reproduced, trace-backed and unverified evidence honestly. Summarise minor findings separately; say when none were retained. Recommendations are not implemented fixes.
7. **Reading order and invariants:** a short guided route through the decisive files and the behaviours future changes must preserve.
8. **Complete grouped change inventory:** all files in the exact reviewed diff, labelled added/modified/deleted (and renamed where applicable), grouped by responsibility in expandable sections. Do not fabricate contents for deleted files or infer ownership solely from paths.
9. **Sources and validation:** repository/head/base/merge-base pins, dirty-state inclusion/exclusion, checks performed and gaps. Cite this run's evidence, never claim previous test results were rerun.

Use the `generate-html` renderer for the explanatory Markdown, then add the visual map and expandable inventory to the generated HTML if needed. Its renderer escapes raw Markdown HTML. Verify inline code paths retain literal underscores rather than becoming emphasis markup. Keep all assets inline: no CDN, fonts, analytics or network dependencies. Do not embed credentials or dump private source code; use small synthetic payload examples when helpful.

Before reporting completion, verify the HTML exists, contains the title and complete inventory, has no placeholder tokens, and every internal map/navigation link resolves. Check inventory counts against Git. Open it with `open` on macOS or `xdg-open` on Linux when a desktop session is available. Report any visual verification gap; opening alone is not proof of visual correctness. The page and any supporting evidence must survive worktree removal.

For every blocker and major finding, require the child to also return:

- a plain-language explanation of the failure scenario and user/system impact;
- precise file and line ranges for both the changed code and any downstream code needed to trace the issue;
- whether the risky line is changed by the branch or is pre-existing code brought into scope by the change;
- the best inline PR-comment anchor, preferring a changed line in the reviewed branch; and
- concise, paste-ready PR comment text that explains the problem and requests the smallest safe correction.

The anchor must be where the branch introduces or triggers the behaviour, even when the final failing call is indirect. Trace through manager/helper/task calls before choosing it. If no honest inline anchor exists, explicitly recommend a file-level comment instead of attaching the finding to an unrelated line.

State that the child is a leaf: it must not spawn agents, edit repository files, commit, push, merge, deploy, or clean up the worktree. Writing the HTML and supporting artefacts outside the repository is permitted.

Before launching, print the required orchestration line:

```text
<branch-slug>-review | reviewer | review | <exact-model> | <WORKTREE_PATH>
```

Then launch the child and end the turn. Do not poll. Pi will deliver the result automatically.

## 3. Clean up after delivery

When the child result arrives, first inspect the HTML and preserve its full findings and evidence outside the worktree. Confirm the code-map contract and pinned scope are satisfied before declaring completion or cleaning up; a missing/incomplete deliverable is a failed review, not successful cleanup. Then run:

```bash
"$HELPER" cleanup-success "<WORKTREE_PATH>"
```

Interpret the result:

- `REMOVED=...` — cleanup succeeded.
- `RETAINED_DIRTY=...` — unexpected changes exist; leave them untouched and tell the user the path.
- A cleanup error — report it and leave the path available for inspection. Never retry with `--force`.

If the child fails, is interrupted, or never completes its review, run:

```bash
"$HELPER" cleanup-failed "<WORKTREE_PATH>"
```

This clears the active marker but deliberately retains the worktree. Tell the user it will be eligible for safe pruning on a future run if it remains clean.

## 4. Final response

Lead with the review verdict and state the blocker, major, and minor counts accurately. Do not call major findings blockers.

Present every blocker and major finding separately using this structure:

1. **Finding title and severity**
2. **Simple explanation** — describe the concrete failure sequence without assuming familiarity with the implementation
3. **Why it matters** — state the observable user, data, security, performance, or operational impact
4. **Locations** — list precise file and line ranges, distinguishing changed lines from downstream or pre-existing context
5. **Where to comment** — identify the best changed-line anchor, or say that it should be a file-level comment
6. **Suggested PR comment** — provide concise text ready to paste into the review

When a finding crosses files, show the call/data flow that connects them. Do not claim a function is called directly when the trace is indirect. Summarise minor findings more briefly unless the user requests the same detail.

Then include:

- checks/tests run and any validation gaps;
- the code-map HTML's absolute path and `file://` URL, with a brief description of its visual map, traced flows and grouped inventory; and
- whether the worktree was removed or retained, with its path when retained.

Do not offer to apply fixes. This skill's deliverable is the reviewed code-map walkthrough and safe lifecycle handling. Do not generate the former standalone findings-only HTML report as an additional deliverable.
