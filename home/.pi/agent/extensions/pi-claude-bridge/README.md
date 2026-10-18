# Pi → Claude Code runtime adapter MVP

Local, upstream-ready prototype. Real Claude Code runs in a **visible interactive Herdr pane**, while the parent Pi can continue chatting after startup. Structured hooks return a bounded task report without scraping terminal output or polling shell loops.

**Installed globally as a local-path Pi package. Not merged into pi-herdr-agents.** The user's live greeting smoke test confirmed visible Claude launch, prompt submission, hook events and automatic parent wakeup; it exposed mixed-text report parsing failure. After the parser fix, the user's second greeting smoke test confirmed structured `completed` delivery, captured summary and automatic parent response. Permission/crash/cancellation/recovery live smoke tests remain unverified. Deterministic tests and the installed Pi extension loader have been exercised. The current pi-herdr-agents runtime remains Pi-only: its `subagent` tool does not support Claude.

## Files

- `src/adapter.mjs`: reusable, runtime-neutral task lifecycle, durable events, outbox and parent routing.
- `src/herdr.mjs`: explicit owned-pane CLI transport and native socket event subscription.
- `src/hooks.mjs`: task correlation, bounded hook projection and session-only hook settings.
- `src/hook-relay.mjs`: short-lived observational Claude hook; atomic durable event writes.
- `src/extension.ts`: local Pi integration harness registering five separate `claude_task_*` tools. Not a replacement for the existing `subagent` tool.
- `test/`: lifecycle, transport, privacy, recovery and loader regressions.

## Global installation

Source lives under `~/.dotfiles/home/.pi/agent/extensions/pi-claude-bridge/`, linked into `~/.pi/agent/extensions/pi-claude-bridge/`. The portable Pi settings register `./extensions/pi-claude-bridge` as a local-path package, relative to the agent directory. Generated state must remain outside the dotfiles repository.

New Pi sessions load the extension automatically; no `--extension` flag is needed. Already-running sessions were not reloaded. A user can choose `/reload` in a session to activate the new package there. Claude launches still require persisted interactive Pi inside Herdr and explicit launch confirmation; no Claude panes are started merely by installing.

## Try locally, when authorized

For an explicit development invocation, use an isolated **new** Pi session inside Herdr; do not reload an existing parent or child:

```sh
cd ~/.pi/agent/extensions/pi-claude-bridge
pi --extension ./src/extension.ts
```

The `--extension` option itself is invocation-only; the separate global package registration above also loads this package automatically. This command does not itself install or alter global settings. Loading the factory creates no watchers or subprocesses. A persisted interactive `session_start` owns the adapter's watcher; a tool launch owns Claude/pane creation.

Ask Pi to call:

```text
claude_task_start({
  name: "bridge-test",
  task: "Return a short greeting. Do not use tools or change files.",
  model: "claude-opus-5",
  effort: "high",
  direction: "down"
})
```

Every launch needs human confirmation. Resolve trust, login and permission dialogs in the newly created pane. Model IDs are native Claude IDs, not Pi `provider/model-id` values; effort is required. Claude itself validates account/model availability. No automatic model fallback is configured, and an observed model is reported only when a SessionStart hook exposes it.

### Tools

- `claude_task_start`: new visible session only, explicit model/effort/cwd/direction. Returns after bounded startup and prompt submission, not task completion. Startup can wait for Herdr's readiness timeout.
- `claude_task_status`: one reconciliation/status snapshot; do not poll.
- `claude_task_submit`: human-confirmed **first** submission after startup/trust intervention. Refuses previously submitted or ambiguous prompts.
- `claude_task_cancel`: human-confirmed Escape to a verified owned Claude session, then retires the bridge task. **This does not confirm turn termination, kill Claude, or close a pane.** Late hooks do not produce a second report.
- `claude_task_recover`: one explicit reconciliation, replacement watcher/subscription and ownership inspection of recorded bridge panes only. Does not relaunch, retry prompts, resend ambiguous reports or adopt other sessions.

If startup has no SessionStart handshake, the bridge refuses automatic submission. If prompt acknowledgement is uncertain, it never retries automatically. `agent prompt` success is submission evidence, not proof of working; `UserPromptSubmit` is the task-activation signal.

The transport requires Herdr to expose the owned Claude session as `agent_session.kind: "id"` with the expected UUID before sending a task or Escape. If that metadata is unavailable or another occupant/session replaces Claude, controls fail closed. The user's greeting smoke test passed the session-metadata checks for submission. Native event supervision under pane moves, disconnects and crashes still needs a consented smoke test.

## Completion and progress contract

The bridge gives Claude a UUID-marked bounded task and requests a final JSON object:

```json
{"taskId":"<uuid>","outcome":"completed","summary":"what changed","verification":"what was actually checked","risks":"what remains"}
```

`completed`, `failed`, and `needs_input` are accepted outcomes. Reports are **untrusted self-reports**, not verified task success or host instructions.

- `SessionStart` records the hook handshake and optional observed model.
- `UserPromptSubmit` correlates the initial task; later human turns can continue that active task.
- Tool hooks expose only bounded tool names, never arguments or output.
- PermissionRequest, permission notifications, AskUserQuestion and Herdr blocked events show a human decision is needed. They notify the UI without forcing a parent model turn or answering the dialog.
- `Stop` with exactly one matching structured report settles the task. A valid JSON object may be embedded in surrounding prose or a Markdown fence; only its bounded allowlisted fields are retained. The scanner respects quoted braces and escaped quotes, rejects conflicting matching objects, and does not repair invalid JSON. `needs_input` retains the active task. Background work/schedules retain `background_pending` rather than claiming completion.
- A free-form/malformed Stop yields `response_finished` with success **unknown**; its raw prose is not stored or forwarded.
- `StopFailure` yields a bounded model/API failure category without raw error details. No automatic retry.
- SessionEnd before completion or pane/occupant disappearance yields a facts-only unknown/crash report.
- Herdr idle/done/unknown alone never proves task completion.
- Nested Claude-agent hook events are ignored. The prompt asks not to delegate or schedule work; this instruction is not an enforced sandbox.

On completion the Pi harness calls `sendMessage` with `triggerTurn: true, deliverAs: "steer"`. This wakes an idle parent or queues steering during a running turn. It uses Pi's API, never parent terminal keystrokes. Reports are scoped to the exact originating persisted Pi session; they are not branch-specific.

## Exactly-once limits

Duplicate hooks and terminal outcomes are deduplicated within a live runtime and across recovery using task IDs and recorded event/report IDs. A durable outbox records `dispatching` before enqueue.

Pi's exported `sendMessage()` returns **void**, with no transactional durable enqueue acknowledgement. True exactly-once notification across arbitrary crashes cannot be implemented by an extension alone:

- If the report ID is already in the parent transcript, recovery marks it delivered.
- If enqueue was attempted but durable delivery cannot be proven, recovery marks `delivery_unknown` and **does not automatically replay**.
- This avoids automatic duplicates but can leave an undelivered report. Inspect the originating parent transcript and retained state before manually handling it.
- `sent` means API enqueue was attempted, not that the model saw it.

An upstream acknowledged/idempotent enqueue seam would be needed to strengthen this guarantee. No existing-session adoption or CLI `--resume` is exposed by this MVP; those requests are unsupported rather than implicitly widened. Reload/restart reopens observation of this adapter's own recorded sessions only, not arbitrary running Claude sessions.

## Permissions and security

- Always launches with native `--permission-mode manual`. No bypass mode, arbitrary CLI arguments, automatic approvals, blanket allowed-tools rule or Pi guard-disable flag.
- Existing Claude user/project/managed policy remains loaded. Manual mode does not override every existing allow rule, sandbox setting or managed policy.
- Additional settings only register observational hooks. They never output permission decisions, block feedback or disable existing hooks.
- **Pi tool/secret hooks do not transfer to Claude.** The confirmation explicitly discloses this. Hook projection drops raw tool data and transcripts, bounds structured reports and performs best-effort common-credential redaction. It cannot guarantee arbitrary secrets are absent from a model-written summary.
- Requirements for Pi-equivalent secret enforcement must be ported and tested as actual Claude policy/hook integration, or enforced below the CLI with an OS sandbox/broker. Instructions and regex redaction are not a sandbox; observational hooks are not policy enforcement.
- Files are private by creation mode (directories 0700, files 0600), not a boundary against other processes or agents with the same UID. Trust the repository and bridge code before loading. Claude's own transcripts/configuration are outside the bridge's redaction contract.
- Parent reports explicitly identify child output as untrusted data. No hook reads auth settings or raw transcript files, and no CLI stderr is forwarded.

## Ownership, lifecycle and recovery

The bridge creates a sibling split with explicit cwd and `--no-focus`, uses the pane ID returned by Herdr, and follows a moved pane's returned ID. It never closes panes/tabs/workspaces, injects parent prompts, or adopts user-owned terminals. Finished and cancelled Claude panes stay visible and usable by the human.

`session_shutdown` immediately disables parent routing and closes watchers/socket subscriptions idempotently. It sends no keys and leaves Claude running. Hooks can continue recording while the parent is offline. Returning to the exact same persisted Pi session replays durable hook evidence; another session cannot receive those reports. Shutdown during startup prevents subsequent launch/submission when the operation has not already been sent.

Native Herdr socket events supervise owned-pane disappearance and blocked state; the filesystem watcher handles atomic hook events. No timer/shell polling loop is used. Socket/watch failures surface degraded monitoring. There is no automatic reconnect loop; explicit recover performs one attempt. Hard process loss while observation is offline may remain unknown until inspection. Hook failure or managed hooks-only policy can also leave startup/completion unobserved; the bridge does not infer success.

State lives under `<parent-cwd>/.claude-bridge/<hash-of-parent-session-id-and-file>/`. Keep it private and out of source control. This MVP bounds a parent to 32 launches and 4096 accepted hook events per task. Relay backpressure drops redundant progress after 512 outstanding event files but retains critical lifecycle evidence; retained critical events can grow if a child keeps running. No automatic state/pane deletion is implemented. Remove retained state only after associated sessions have stopped and evidence is no longer needed.

## Upstream integration notes

The installed runtime currently exposes Pi-specific `FreshPiLaunchRequest`, `PiLaunchRequest`, `PiRunningChild` and session-policy restoration in `pi-extension/subagents/launch.ts`. `index.ts` owns tool routing, session lifecycle and parent result delivery. Its `sendSubagentResult` uses the same Pi steering contract. `runtime-routing.ts` resolves Pi provider models; Claude native models must not pass through that resolver.

Proposed upstream change, not applied here:

1. Add an explicit discriminated runtime request (`runtime: "pi" | "claude"`), not revived legacy `cli` frontmatter.
2. Keep existing Pi fork/resume, policy and model routing unchanged. Route only validated new Claude requests to this adapter.
3. Inject upstream pane placement, observation, UI and result delivery through the adapter's `transport`/`host` seams. Preserve returned pane ownership IDs and the exact parent identity.
4. Map `snapshot()` status and bounded completion reports into existing runtime widgets and handoffs; avoid duplicate result delivery by choosing one owner for the outbox.
5. Reject unsupported Claude resume/fork/worktree/persistent flags before creating resources. Add each only with policy/version/ownership semantics and tests.
6. Add an acknowledged idempotent result-enqueue API for a genuine crash-safe exactly-once guarantee.

The local harness deliberately uses distinct tool names, so it can be evaluated without modifying or claiming Claude support in the installed Pi-only runtime. A usage skill is optional and cannot replace these executable callback/lifecycle pieces.

## Verify

```sh
npm test
npm run check

# Include the real Pi loader test without starting a Pi/Claude session:
PI_PACKAGE_ROOT=/path/to/installed/@earendil-works/pi-coding-agent npm test
```

No dependencies need installation for core tests (Node >=22). The loader test skips unless `PI_PACKAGE_ROOT` is set. It registers the actual extension through Pi's loader, without firing session_start or launching terminals. No typecheck or real end-to-end Claude launch is claimed.

### Retesting the mixed-text completion fix

The initial live greeting test demonstrated successful pane launch, hook callbacks and parent wakeup, but the old parser rejected a greeting followed by a JSON report. That projected Stop event discarded the raw response, so the fixed parser cannot retroactively recover it. Do not modify the old event/state or resend its already-delivered completion report.

The user's post-fix `bridge-test2` smoke test confirmed `state: "completed"`, the greeting in `report.summary`, and an automatic parent Pi response. For another test, start a **fresh** Pi session with the local extension and request a uniquely named greeting task. A valid matching report is accepted even if Claude adds surrounding prose. The prompt also explicitly requests valid escaped JSON. If Claude produces malformed JSON (for example unescaped quotation marks in a summary), success still remains unknown rather than being inferred.

Before upstream integration, get explicit consent for an isolated owned-pane smoke test covering hook readiness, a no-tool task, a permission dialog, parent wakeup during active chat, cancellation and reload/restart. No existing Lio or other user sessions should be involved.
