---
name: worktree-review
description: Fetches a remote Git branch into a fresh isolated review worktree, runs Pi's architecture-review workflow there, then safely removes the clean worktree. Supports a fast GLM reviewer mode. Use when the user says "worktree review <branch>", asks to review a branch without touching the current checkout, or invokes /skill:worktree-review.
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

Parse and validate the arguments before creating anything. In fast mode, also confirm that `openrouter/z-ai/glm-5.3-flash` is available and authenticated; if not, report that fast mode is unavailable and stop before preparing a worktree.

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

- **Default:** use `thinking: "high"` and an exact authenticated Codex review model. Prefer `openai-codex/gpt-5.6-sol`, then `openai-codex/gpt-5.6-terra`. Do not use Luna for reviews. If neither is available, inspect the live catalogue and choose the newest authenticated Codex model rather than falling back to Claude.
- **Fast (`fast` or `--fast`):** use exactly `openrouter/z-ai/glm-5.3-flash` with `thinking: "high"`. If that exact model is not authenticated, report that fast mode is unavailable and stop; do not silently fall back to another model.

Never use an Anthropic/Claude model in either mode.

Use the `subagent` tool with:

- `agent: "reviewer"`;
- `cwd: WORKTREE_PATH`;
- no managed `worktree` argument, because the helper already created the worktree;
- a stable name ending in `-review`, derived from a short branch slug;
- the exact `model` and `thinking` selected above;
- bash-guard disabled from process startup via Pi's `--bash-guard-disabled` flag, so the autonomous reviewer cannot stall on interactive confirmations; the Herdr launcher must supply this flag for fresh and resumed children—do not rely on asking the child to run `/bash-guard` after launch.

Prompt the child to:

1. review the exact range `origin/main...HEAD` for the named branch;
2. read all repository instructions that govern changed files;
3. load and follow `~/.pi/agent/skills/architecture-review/SKILL.md` completely;
4. remain read-only and make no implementation changes;
5. run the narrowest relevant validation;
6. generate the architecture-review HTML report outside the repository, as that skill requires; and
7. return the verdict, blocker/major counts, validation performed, and absolute HTML report path.

For every blocker and major finding, require the child to also return:

- a plain-language explanation of the failure scenario and user/system impact;
- precise file and line ranges for both the changed code and any downstream code needed to trace the issue;
- whether the risky line is changed by the branch or is pre-existing code brought into scope by the change;
- the best inline PR-comment anchor, preferring a changed line in the reviewed branch; and
- concise, paste-ready PR comment text that explains the problem and requests the smallest safe correction.

The anchor must be where the branch introduces or triggers the behaviour, even when the final failing call is indirect. Trace through manager/helper/task calls before choosing it. If no honest inline anchor exists, explicitly recommend a file-level comment instead of attaching the finding to an unrelated line.

State that the child is a leaf: it must not spawn agents, edit, commit, push, merge, deploy, or clean up the worktree.

Before launching, print the required orchestration line:

```text
<branch-slug>-review | reviewer | review | <exact-model> | <WORKTREE_PATH>
```

Then launch the child and end the turn. Do not poll. Pi will deliver the result automatically.

## 3. Clean up after delivery

When the child result arrives, first preserve its full report details, then run:

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
- the HTML report's absolute path and `file://` URL; and
- whether the worktree was removed or retained, with its path when retained.

Do not offer to apply fixes. This skill's deliverable is the review and safe lifecycle handling.
