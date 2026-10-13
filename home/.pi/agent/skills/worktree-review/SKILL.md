---
name: worktree-review
description: Review a remote branch in an isolated worktree and produce a visual HTML code map with evidence-backed findings. Use for worktree reviews or /skill:worktree-review; supports an optional fast mode.
compatibility: Requires Git, an origin remote, Pi subagents and Node.js 20 or newer. Codemode is preferred when available.
---

# Worktree Review

Review-only: leave the current checkout and reviewed branch unchanged. Deliver one readable code-map HTML page, then safely clean up the review worktree.

## 1. Select the branch and reviewer

Accept one remote branch name and an optional `fast` or `--fast` flag, in either order. Reject extra arguments. If the user supplies a PR URL, resolve its exact head branch and repository; do not guess a branch or silently review a different repository. Ask for a branch if neither is supplied.

| Mode | Exact model | Thinking |
| --- | --- | --- |
| Default | `openai-codex/gpt-6.1-sol` | `xhigh` |
| Fast | `openrouter/z-ai/glm-5.3-flash` | `high` |

Confirm the selected model is available and authenticated **before** creating a worktree. If unavailable, stop and report which mode is unavailable. No model fallback or Anthropic/Claude reviewer.

## 2. Prepare an isolated snapshot

Resolve the helper relative to this skill and run it from the invoking repository:

```bash
HELPER="<skill-directory>/scripts/worktree-review.sh"
"$HELPER" prepare "<remote-branch>"
```

Capture `WORKTREE_PATH`, `TARGET_COMMIT` and `BASE_REF`. The helper fetches the exact branch and `origin/main`, then creates a unique detached worktree outside the repository. On fetch failure, report the exact Git error and stop; do not substitute a local or similarly named branch.

The helper owns lifecycle safety: it prunes only eligible clean review leftovers, protects active markers younger than one day, and never removes dirty worktrees. Failed/interrupted reviews remain available for later safe pruning. Never use `--force` for cleanup.

## 3. Launch one leaf reviewer

Print this orchestration line before launch:

```text
<branch-slug>-review | reviewer | review | <exact-model> | <WORKTREE_PATH>
```

Call `subagent` with:

- `agent: "reviewer"`, a short branch-derived name ending in `-review`, and `cwd: WORKTREE_PATH`;
- the exact selected `model` and `thinking`, with `fork: false` for a fresh session;
- **no** managed `worktree` argument: the helper already created it;
- `tools: "read,bash,grep,find,ls,codemode"` when Codemode is available. This explicit override matters: the packaged reviewer defaults omit Codemode. Otherwise use `"read,bash,grep,find,ls"` and disclose the fallback.

Keep bash-guard enabled. Herdr sets `PI_SUBAGENT_ID` for fresh and resumed children, which selects noninteractive guard mode: routine review commands run without approval prompts, while the guard's destructive-command blocklist remains active. Do not pass a guard-disabling option or ask the child to run `/bash-guard`. If a required command is blocked, report the validation gap rather than bypassing the guard. The guard is a shell-pattern check, not a read-only sandbox; the reviewer restrictions below still apply.

Give the child the branch, expected target commit, worktree path and this skill path. Require it to read this skill and follow the **Reviewer assignment** and **HTML layout** below. After launching, end the turn; results arrive automatically. Do not poll status or session logs.

### Reviewer assignment

- You are a leaf. Do not spawn agents, edit repository files, commit, push, merge, rebase, deploy or clean up the worktree. HTML and evidence may be written outside the repository.
- Pin repository identity, HEAD, the `origin/main` tip and merge-base. Confirm HEAD matches the parent's expected target; a mismatch makes the review incomplete. Inspect the complete inventory and diff for exactly `origin/main...HEAD`; use pinned SHAs thereafter. Exclude and inventory staged, unstaged and untracked changes.
- Read the repository instructions governing changed files. Read `~/.pi/agent/skills/architecture-review/SKILL.md` completely and apply sections 1–5. Replace its report format with the layout below; do not produce a second report.
- Trace affected callers, helpers, managers and tasks before judging behaviour. Distinguish changed code from pre-existing context and reproduced findings from trace-backed or unverified concerns.
- Run the narrowest relevant validation without modifying the checkout. Use a pinned temporary archive outside it for commands that generate files. Report checks from this run and any gaps, not previous results as reruns.
- Read `~/.pi/agent/skills/generate-html/SKILL.md` and use its renderer for explanatory Markdown. **Skip its desktop-opening step. The child must not run `open`, `xdg-open` or another desktop launcher.** This workflow's parent alone opens the final page after verification. Headless visual checks are allowed.
- Write one self-contained HTML page and supporting evidence outside the worktree so they survive cleanup. Return the verdict, accurate blocker/major/minor counts, findings, validation/gaps, absolute artefact paths and pinned identity.

### Use Codemode where it helps

If `codemode` is exposed, prefer it for batches of independent reads/searches, filtering large outputs and chaining dependent checks. Use direct tools for a single simple call or reading image attachments. If Codemode is unavailable in the child, continue with ordinary tools and report that limitation; do not silently claim it was used.

Read Pi's `docs/codemode.md` for the installed version before first use. Scripts are raw JavaScript in a sandbox: no Node, file system, network or timers; call available tools through `tools.<name>(args)`. Start scripts with `// @reasoning: <goal>` (after any `// @options:` line). Tools called inside scripts do not take a `reasoning` argument.

Use `Promise.allSettled()` for independent calls and inspect failures. Await every call; do not run dependent checks in parallel. Show only relevant results, while preserving full diff, inventory and validation evidence outside the worktree. Read required guidance completely. Codemode changes tool orchestration, not review scope, permissions or evidence standards.

## HTML layout: explain first, evidence second

Write for a developer encountering the feature for the first time. Use plain language, short headings, short paragraphs and one idea per bullet. Avoid dense compound sentences and repeated summaries. Introduce a technical term before using it.

Keep feature explanation, review findings and validation distinct. Function names, long file paths, line ranges and audit metadata belong in linked or expandable evidence details, not every introductory sentence. Preserve all evidence without making it the main reading path.

Use this reading order:

1. **What changes:** up to three plain-language bullets describing user-visible behaviour. Add a compact Before → After comparison, what stays unchanged and any rollout gate. Show verdict and severity counts separately.
2. **Visual map:** clickable inline SVG or HTML/CSS nodes and directional arrows for entry points, changed layers and dependencies. Label nodes **NEW**, **CHANGED** or **REUSED** from the diff. Link nodes to the corresponding numbered flow; mark risk boundaries with links to findings. No ASCII-only map.
3. **How it works:** numbered steps following the relevant control/data path. Explain each step briefly, then provide its function/path/snapshot-line evidence. Cover loading, filtering, rendering, state, persistence and actions only where applicable. Do not present indirect calls as direct calls.
4. **Contracts and shared changes:** separate subsections for payloads, local/persisted state, identity, permissions, side effects, partial failures, compatibility and limits where relevant. Identify shared primitives and affected callers; presentation metadata is not server authorisation.
5. **Review findings:** one clearly separated card/section per blocker or major, linked back to its causal map boundary. Summarise minors separately, or say none were retained. Recommendations are not implemented fixes.
6. **Reading guide:** a short route through decisive files and the invariants future changes must preserve.
7. **Files and validation:** expandable grouped inventory of every file in the pinned diff, with added/modified/deleted/renamed status. Include repository/head/base/merge-base pins, dirty-state exclusions, checks and gaps. Do not infer deleted contents or ownership from paths alone.

Give each finding a short title and explicit severity. For each blocker or major, include:

- **Problem:** concrete failure sequence and preconditions in plain language.
- **Impact:** observable user, data, security, performance or operational consequence.
- **Evidence:** reproduced, trace-backed or unverified; precise changed-code and downstream file/line ranges, plus the connecting flow.
- **Comment location:** best changed-line PR anchor where the branch introduces/triggers the issue. Distinguish changed and pre-existing lines. If no honest inline anchor exists, recommend a file-level comment.
- **Suggested PR comment:** concise, paste-ready text requesting the smallest safe correction.

### Render and verify without opening

Use the `generate-html` renderer, then add the visual map, expandable evidence and inventory to its output as needed; raw Markdown HTML is escaped. Keep all assets inline, with no CDN, fonts, analytics or network dependencies. Do not embed credentials or private source dumps; use small synthetic payloads if helpful.

Before returning, verify:

- the HTML exists, contains its title and has no placeholder tokens;
- every map/navigation target resolves and inline code paths retain literal underscores;
- inventory paths, statuses and counts match the pinned Git diff;
- pins, complete findings and supporting evidence are outside the worktree;
- any visual checks and their limits are reported honestly. Desktop opening is not proof of visual correctness.

## 4. Verify, clean up, then open once

When the child returns, inspect the HTML and preserved evidence. Confirm the pinned scope, findings and layout are complete before declaring success or removing the worktree. Do not open drafts or intermediate versions.

For a complete review, run from the invoking repository:

```bash
"$HELPER" cleanup-success "<WORKTREE_PATH>"
```

- `REMOVED=...` or `ALREADY_REMOVED=...`: cleanup succeeded.
- `RETAINED_DIRTY=...`: leave unexpected changes untouched and report the path.
- Cleanup error: report it and retain the path; do not retry with `--force`.

For a failed/interrupted review or missing/incomplete deliverable, run `cleanup-failed` instead. This clears the active marker but retains the worktree. Report that it can be safely pruned on a future run if still clean.

**Only after final verification and lifecycle handling, the parent opens the final HTML once**, using `open` on macOS or `xdg-open` on Linux when a desktop is available. Record the opening attempt in the preserved evidence before launching, so a resumed turn cannot repeat it. Do not reopen after follow-up checks or wording changes unless the user explicitly asks. If opening fails or no desktop is available, return the path and URL without automatic retries. An incomplete review is not opened automatically.

## 5. Report the outcome

Lead with verdict and accurate **blocker / major / minor** counts. Major and minor findings are not “blockers”.

For each blocker/major, return the same five clearly labelled parts used in the HTML: problem, impact, evidence locations (changed versus context), comment location and paste-ready PR comment. Summarise minors briefly.

Finish with checks/gaps, the HTML's absolute path and `file://` URL, and whether the worktree was removed or retained (include its path if retained). Describe the page in one sentence. Do not offer to apply fixes.
