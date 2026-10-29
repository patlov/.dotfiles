---
name: rex-review
description: Run a single or batch PR review with supervised Pi reviewers in Rex tabs, normally in a dedicated session. Reuses worktree-review and batch-worktree-review for review standards and reports.
compatibility: Requires a local Rex session, the pi-terminal-agents wrapper, its rex_agents_session and subagent tools, and the sibling review skills.
---

# Rex Review

Use Rex for terminal placement, the Pi subagent host for lifecycle, and the existing review skills for methodology. Do not launch unmanaged `pi` processes or duplicate the worktree helper.

## Select the workflow

Accept the same targets and `fast` / `--fast` mode as the shared review skills, plus optional `--here`. Strip `--here` before handing the request to them. With no targets, ask for them before creating resources.

- One branch or PR URL: read `../worktree-review/SKILL.md` completely.
- Multiple PR numbers, URLs or branches: read `../batch-worktree-review/SKILL.md` completely and follow its single-review cross-reference.
- A single PR number: resolve it to its exact URL with read-only `gh` queries against the invoking repository's explicit origin identity, then use the single-review workflow. Do not guess a branch or repository.

Follow the shared workflow's input/model preflight before creating a Rex session or worktree. Its scope, immutable pins, reviewer assignments, validation, HTML and cleanup rules remain authoritative.

## Place the reviewers

Confirm `REX_SESSION` is set and `rex_agents_session` is available. If the wrapper is missing, report that Pi must be restarted after installation; `/reload` alone cannot switch an existing Herdr-owned host to Rex. A Rex CLI on PATH without the supervised tools is not sufficient. This skill's Rex routing overrides the upstream operating guide's Herdr-only availability statement; its lifecycle contracts still apply.

By default, call `rex_agents_session` with `action: "new"` and a short task-derived `label`, such as `asklio-pr-reviews`. With `--here`, use `action: "here"` instead. Save the returned full `sessionId` in the batch manifest or single-review evidence. Create/select once per invocation, not once per child. Existing child runs keep their original destinations.

The default Rex layout is one tab per reviewer, without stealing focus. A configured split layout only works with `--here`; if a separate session is requested while the host is configured for splits, report the placement conflict before dispatch rather than silently changing configuration.

Call the shared `subagent` tool with the shared workflow's exact model/thinking, leaf restrictions, tools, `fork: false`, and helper-created worktree path as `cwd`. Omit the managed `worktree` argument: that provisioning path is Herdr-only, and the helper already supplies the isolated checkout. Do not pass this entire routing skill to a child; it reads only the shared reviewer assignment and HTML layout.

After launching the group, restore the future-child destination with `rex_agents_session` `action: "here"`; existing reviewers stay in their batch session. Then end the turn. Results arrive automatically; do not poll Rex captures, process lists or session logs. Use `subagent_cancel` for cancellation, not raw Rex pane closure.

## Deliver and retain

Apply the shared workflow's result verification, safe worktree lifecycle and one final HTML-opening attempt. If a launch fails, record the actual failure and retain prepared worktrees as prescribed there. For a batch, keep failed inputs visible in its index.

Retain the Rex session for inspection, including after failure. Do not kill it or close unrelated panes as cleanup. Report its label/full ID alongside the final HTML path. Rex does not replace a running parent Pi coordinator; if that process exits, persistence of terminal tabs alone does not deliver callbacks to a new parent.
