# Pi terminal agents

Use the existing `pi-herdr-agents` supervisor with Rex or Herdr. This extension injects a Rex `SurfaceProvider`; it does not fork the host or modify installed npm files. The upstream host still owns Pi launch policy, file-event completion, automatic parent delivery, persistent specialists, retries, interruption, cancellation, and reload adoption.

## Setup

Keep `npm:pi-herdr-agents` installed, but disable its standalone extension entry point in Pi settings:

```json
{ "source": "npm:pi-herdr-agents", "extensions": [] }
```

Link this directory into `~/.pi/agent/extensions/pi-terminal-agents`, then restart Pi once. An already-loaded host preserves its terminal backend across `/reload`, so first-time migration requires a new Pi process; skill changes and future-child layout changes can use `/reload`. Restart after changing provider code, because reload deliberately retains the provider instance and live ownership. Only this wrapper should register the subagent tools. It resolves the host from `$PI_CODING_AGENT_DIR/npm/node_modules` (default `~/.pi/agent/npm/node_modules`), where Pi installs the configured npm package. No separate dependency installation is needed for this directory.

Rex injection is checked against host version **3.3.1**. An incompatible host version fails closed until the adapter is validated; this is an internal seam, not a stable public plugin API. Herdr uses the host's normal entry point.

## Routing

- Inside Rex, without an active Herdr socket, use Rex.
- Inside Herdr, preserve the upstream Herdr backend.
- Set `PI_TERMINAL_BACKEND=rex` or `herdr` before starting Pi to resolve nested-terminal ambiguity explicitly.
- Rex requires a local Unix-socket server. Remote servers are rejected because the host observes local files and processes.

Rex's default is one tab per child, without stealing focus. The host's existing `panes.mode: "split"` setting instead creates a split beside the original Pi pane; splits require the original session. `grouped` maps to tabs on Rex. Model preferences and all other policy remain in `~/.pi/agent/herdr-agents/config.json`.

## Sessions

```text
/rex-agents                         # Show the destination for future children
/rex-agents new asklio-pr-reviews     # Create a separate session and use it
/rex-agents select session:FULL_ID    # Use an existing session
/rex-agents here                     # Restore the original Pi session
```

The model can do the same through `rex_agents_session` with `action: new | select | here`, plus `label` for creation or `sessionId` for selection. Existing children remain supervised in their original sessions. Creating a session does not switch the visible app; choose it in Rex when you want to inspect it. The initial Overview tab is a shell for manual use, not another agent.

## Reviews

```text
/skill:rex-review feature/catalogue
/skill:rex-review 123 456 789
/skill:rex-review --here https://github.com/owner/repo/pull/123
```

`rex-review` selects a dedicated Rex session, then reuses the existing single/batch review skills. Their helper prepares isolated detached worktrees and supplies their paths as each child's `cwd`. Review methodology, report generation, pinning and safe cleanup are not duplicated here. `--here` keeps the original session instead.

## Limits and safety

- Rex supports ordinary panes, including children whose `cwd` is an externally prepared worktree. The host-managed `worktree` parameter, `/worktree`, and managed-worktree inventory/removal are **Herdr-only**. The adapter rejects provisioning rather than approximating the host's ownership and Linux process-identity guarantees.
- `subagent_cancel` records terminal intent through the upstream host before closing the owned Rex block. Missing/unreachable server data is not treated as confirmed termination. Escape interrupts a turn; it is not cancellation.
- The adapter only sends input to or closes blocks it created. It never closes the parent pane, unrelated panes or entire user sessions. Session removal is a separate manual operation.
- Completion comes from the upstream Pi protocol and filesystem wake-ups, not terminal text scraping. Parent sessions must remain running to receive callbacks. Rex persistence alone does not resurrect a terminated Pi coordinator.
- A new session is not a security sandbox. Review restrictions and bash-guard still apply; the guard is never disabled by this extension.

## Verification

```sh
npm test
PI_TEST_REX=1 npm test
PI_TEST_REX_HOST=1 npm test
```

The first command uses fake CLI responses. `PI_TEST_REX=1` also creates/removes an owned real Rex session and checks launch, output and closure. `PI_TEST_REX_HOST=1` additionally launches real Pi children on `openai-codex/gpt-6.1-sol` with low thinking to check automatic handoff and cancellation; it requires authenticated Codex and can incur model usage. Run live tests inside Rex. No PRs or repository files are changed. Test sessions and scratch directories are removed; normal Pi child transcripts remain in Pi's private session storage.
