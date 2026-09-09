---
name: worktree-review
description: Fetches a remote Git branch into a fresh isolated review worktree, runs Pi's architecture-review workflow there, then safely removes the clean worktree. Use when the user says "worktree review <branch>", asks to review a branch without touching the current checkout, or invokes /skill:worktree-review.
compatibility: Requires Git, a configured origin remote, and Pi subagents.
---

# Worktree Review

Review a remote branch in an isolated worktree without changing the user's current checkout. The argument is the remote branch name. If it is missing, ask for it; never guess.

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

Use the `subagent` tool with:

- `agent: "reviewer"`;
- `cwd: WORKTREE_PATH`;
- no managed `worktree` argument, because the helper already created the worktree;
- a stable name ending in `-review`, derived from a short branch slug;
- `thinking: "high"`;
- an exact authenticated Codex review model; never use an Anthropic/Claude model. Prefer `openai-codex/gpt-5.6-sol`, then `openai-codex/gpt-5.6-terra`. Do not use Luna for reviews. If neither is available, inspect the live catalogue and choose the newest authenticated Codex model rather than falling back to Claude.

Prompt the child to:

1. review the exact range `origin/main...HEAD` for the named branch;
2. read all repository instructions that govern changed files;
3. load and follow `~/.pi/agent/skills/architecture-review/SKILL.md` completely;
4. remain read-only and make no implementation changes;
5. run the narrowest relevant validation;
6. generate the architecture-review HTML report outside the repository, as that skill requires; and
7. return the verdict, blocker/major counts, validation performed, and absolute HTML report path.

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

Lead with the review verdict, then include:

- blocker and major-finding counts;
- checks/tests run and any validation gaps;
- the HTML report's absolute path and `file://` URL;
- whether the worktree was removed or retained, with its path when retained.

Do not offer to apply fixes. This skill's deliverable is the review and safe lifecycle handling.
