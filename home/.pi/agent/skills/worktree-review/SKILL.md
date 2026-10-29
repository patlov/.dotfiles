---
name: worktree-review
description: Review one remote branch or PR in an isolated worktree and produce a visual HTML code map with evidence-backed findings. Supports fast mode; use batch-worktree-review for multiple targets.
compatibility: Requires Git, an origin remote, supervised Pi subagents in Herdr or local Rex, and Node.js 20 or newer. Rex requires the pi-terminal-agents wrapper. Codemode is preferred when available.
---

# Worktree Review

Review-only: leave the current checkout and reviewed branch unchanged. Deliver one readable code-map HTML page, then safely clean up the review worktree.

For multiple PRs or branches, read `../batch-worktree-review/SKILL.md` and use its orchestration instead. This skill remains the shared source for individual review standards and lifecycle handling.

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

Use the supervised host's selected terminal backend. Herdr opens agent panes; the local Rex adapter opens tabs (or configured splits) in its selected session. For a dedicated Rex review session, use `../rex-review/SKILL.md` as the initial parent router; if it already selected a session, keep that destination rather than routing again. Do not substitute raw terminal launches for `subagent`: automatic result delivery and safe cancellation belong to the host. The helper-created worktree is passed as `cwd` on both backends.

Use a bare subagent: this skill supplies the reviewer assignment and does not require an installed agent definition or role pack. Omit the `agent` parameter; `reviewer` describes the work, not a named agent to load.

Print this orchestration line before launch:

```text
<branch-slug>-review | bare | review | <exact-model> | <WORKTREE_PATH>
```

Call `subagent` with:

- a short branch-derived `name` ending in `-review`, and `cwd: WORKTREE_PATH`;
- the exact selected `model` and `thinking`, with `fork: false` for a fresh session;
- `systemPrompt: "You are a review-only leaf. Follow the supplied worktree-review skill and reviewer assignment. Do not spawn agents, modify repository files, commit, push, merge, rebase, deploy or clean up the worktree. Write HTML and evidence only outside the repository."`;
- **no** `agent` or managed `worktree` argument: no named role is needed, and the helper already created the worktree;
- `tools: "read,bash,grep,find,ls,codemode"` when Codemode is available, otherwise `"read,bash,grep,find,ls"` and disclose the fallback. Set this allowlist explicitly rather than relying on agent defaults.

Keep bash-guard enabled. The Pi subagent host sets `PI_SUBAGENT_ID` for fresh and resumed children, which selects noninteractive guard mode: routine review commands run without approval prompts, while the guard's destructive-command blocklist remains active. Do not pass a guard-disabling option or ask the child to run `/bash-guard`. If a required command is blocked, report the validation gap rather than bypassing the guard. The guard is a shell-pattern check, not a read-only sandbox; the reviewer restrictions below still apply.

Set `task` to include the branch, expected target commit, worktree path and absolute skill path. Require the child to read this skill and follow the **Reviewer assignment** and **HTML layout** below. The child follows those sections only; the parent owns branch selection, preparation, launch and cleanup. After launching, end the turn; results arrive automatically. Do not poll status or session logs.

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

The reader should understand what happens and what can go wrong without opening a source file. Write an explanation of this change, not a transcript of the review or a checklist of architectural categories. Keep the review depth; reduce the reading burden.

### Explain concrete behaviour

- Start with who does what, what the system does next, and what the person sees. For infrastructure changes, follow a concrete request, record or job instead. Use a small illustrative example when it makes a rule or branch easier to understand; label invented values as illustrative, not reproduced evidence.
- Prefer actors and verbs: “The server signs the path without checking which tenant owns it”, not “The new conversion crosses a capability boundary”. Introduce necessary terms where used; do not rename familiar concepts with metaphors such as lanes, handoffs or orchestration.
- Explain why a detail matters. “The old file list replaces the new one, so the second attachment disappears” is useful; “Snapshot identity is a correctness boundary” is not an explanation on its own.
- Put each explanation in one place. Do not repeat the same claim in the introduction, Before/After, flow, contracts, architecture assessment and reading guide. Omit empty categories, boilerplate praise, lists of unchanged layers and defensive caveats that do not affect the verdict.
- Be precise about limits where they change interpretation. Keep “the file is hidden from the normal review flow, not physically deleted” next to that finding; move command history and routine audit metadata to details. Do not remove uncertainty to make prose smoother.

### Reading path

Use descriptive headings that fit the feature. The following is a reading order, not a requirement to fill a fixed set of sections:

1. **The change and verdict.** A short explanation of the previous limitation and the new behaviour, followed by the verdict, blocker/major/minor counts and one sentence explaining the decision. Link directly to significant findings. Include a rollout gate here only if it affects availability or safety. Avoid repeating the introduction in a mandatory Before/After block.
2. **One concrete walkthrough.** Follow a representative input through the changed behaviour to its visible result. Usually a few numbered steps suffice. Show important alternative paths where they diverge: found/not found, success/failure, new/existing record. Do not spend a separate step on every helper, unchanged API layer or cache invalidation unless it explains a material effect.
3. **What needs fixing.** Keep each blocker/major visible as a separate finding with the failure story and correction below. Summarise minors compactly. If no findings were retained, say so once; do not add empty severity sections. In a re-review, briefly distinguish fixed prior findings from remaining ones without retelling the full review history.
4. **Technical detail, on demand.** Collapsed, clearly named disclosures hold precise source references, changed versus reused components, relevant payload/state contracts, permissions, compatibility constraints and a short file-reading route. Include material contracts, shared callers and invariants even when collapsed; do not turn every category into a mandatory prose section. Keep safety-critical facts visible in the walkthrough or finding that depends on them.
5. **Checks and scope.** A short visible summary of what was checked and what remains unverified. Collapsed details contain exact commands/results, the complete grouped added/modified/deleted/renamed file inventory, repository/head/base/merge-base pins, dirty-state exclusions and supporting evidence. Do not infer deleted contents or ownership from paths alone.

Include a clickable inline SVG or HTML/CSS flow map alongside the walkthrough. Label nodes with actions or outcomes (“No order found → wait for a reviewer”), not only module names (“Manager → store”). Make decision branches explicit and use a small number of meaningful nodes; put implementation-level maps in technical details if needed. Label arrows as processing/data flow rather than implying direct calls where none exist. Link steps and failure points to their explanations/findings. Mark NEW/CHANGED/REUSED unobtrusively or in expandable node details, accurately from the diff. The map should add a useful view of the branches, not repeat every paragraph in boxes. No ASCII-only map.

### Finding cards

Give each finding a short consequence-first title and explicit severity. For each blocker or major, keep these visible:

- **Problem:** the affected actor/input and necessary precondition, then the concrete sequence that fails. Use a short numbered sequence for races and partial failures. Synthetic counts or names may clarify the mechanism, but are not reported as measured results.
- **Impact:** what the person sees or which data/security/operational guarantee breaks. Do not merely repeat the title or call it a boundary risk.
- **Correction:** the smallest safe change, described once. Make clear that it is a recommendation, not an implemented fix.
- **Confidence:** reproduced, trace-backed or unverified, with the material mocking/validation limit in one short sentence. A passing defect probe is not proof the feature works.

Put the following in a closed disclosure attached to that finding, with a descriptive summary such as “Code evidence and PR comment”:

- **Evidence:** precise changed-code and downstream file/line ranges and their connecting flow, reproduction results and assumptions. Distinguish changed and pre-existing code.
- **Comment location:** the best changed-line PR anchor introducing or triggering the issue; recommend a file-level comment when there is no honest inline anchor.
- **Suggested PR comment:** concise, paste-ready text requesting the correction. This deliberate actionable duplicate belongs in the disclosure, not beside another visible retelling of the finding.

Use native `details`/`summary` so the main reading path stays short while the complete audit trail remains available. Preserve stable finding anchors for batch-index links. Navigation to a collapsed target must reveal its containing disclosures. Do not hide the verdict, severity, actual failure, correction or material uncertainty behind a click.

### Render and verify without opening

Use the `generate-html` renderer, then add the visual map, expandable evidence and inventory to its output as needed; raw Markdown HTML is escaped. Keep all assets inline, with no CDN, fonts, analytics or network dependencies. Do not embed credentials or private source dumps; use small synthetic payloads if helpful.

Before returning, verify:

- the HTML exists, contains its title and has no placeholder tokens;
- every map/navigation target resolves (including inside disclosures), local report/evidence links exist, and inline code paths retain literal underscores;
- inventory paths, statuses and counts match the pinned Git diff;
- pins, complete findings and supporting evidence are outside the worktree;
- the visible walkthrough explains a concrete result, each finding names its preconditions and consequence, and the same explanation is not repeated across sections;
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
