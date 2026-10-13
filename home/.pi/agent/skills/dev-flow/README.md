# Opt-in Pi development flow

Four native global skills, backed by the existing Pi/Herdr tools. No extra package,
extension, model configuration, persistent mode or publishing permission is required.

## Use

After linking these directories into the live Pi skills directory, run `/reload`:

```text
/skill:dev-flow implement ASK-1234. Verify locally; do not push.
/skill:dev-flow investigate ASK-1234 and propose a design. Stop before product edits.
/skill:dev-flow implement this description using the existing shared primitive.
/skill:blast-radius inspect this branch against the confirmed base.
/skill:design-arena compare designs for this ownership change. Design only.
/skill:prevent-repeat agents keep adding manually synchronised registries.
```

The coordinator accepts ticket contents or descriptions as well as ticket IDs. Fetching Linear
needs an already available integration. With no access, paste the ticket; this pack does not
install MCP servers or change tracker state.

All four skills have `disable-model-invocation: true`. Pi does not advertise them for automatic
selection; invoke one explicitly. Dev-flow reads its sibling skill files itself when a route
is justified. This is not an always-on mode for subsequent unrelated tasks.

Small changes run directly. Bugs need a reproduction. An unresolved consequential architecture
can earn independent designs; a shared contract/security/persistence change earns a safety check.
Missing runtime access or independent reviewers is disclosed, never turned into a passing result.
Prevention starts with proposals and requires approval before enforcement edits.

## Source and installation

The version-controlled source is `home/.pi/agent/skills/` in this dotfiles repository.
Use the repository's `dot` linking workflow on another machine. On the current machine,
only the four new skill directories are linked; unrelated local configuration is untouched.
Pi's native skill discovery provides registration without editing `settings.json`.

Skills use relative links to shared execution/verification instructions under `dev-flow/`.
Install all four together. Generated evidence belongs in the live agent/session artifact area
or a private scratch directory, not the public dotfiles repository.

## Snapshot helper

Requires Node.js 22+ and Git. Commands are read-only with respect to the checkout; output is
written only into a new private directory outside it. External diff drivers/textconv are disabled.

```sh
node ~/.pi/agent/skills/dev-flow/scripts/snapshot-change.mjs --help
node ~/.pi/agent/skills/dev-flow/scripts/snapshot-change.mjs \
  --repo "$PWD" --base HEAD --scope working --out /tmp/my-private-change
node ~/.pi/agent/skills/dev-flow/scripts/snapshot-change.mjs \
  --check /tmp/my-private-change/snapshot.json
```

Choose a new output path with an existing parent. For a branch range, resolve the requested
comparison base explicitly (often `git merge-base <confirmed-base-ref> HEAD`) and pass it with
`--scope branch` or `combined`. The helper itself never fetches or assumes a trunk branch.

The manifest names complete branch/staged/unstaged diffs, inventories paths and hashes untracked
files. `--path` repeats to select literal files/directories; `--include-untracked` repeats to
copy explicitly selected untracked content. The latter does not expand a narrowed path scope.
Symlink captures contain their target string, never the target file's contents.

Freshness checks include relevant contents, not just Git status. They also check stored artifact
integrity. Exit codes are 0 for unchanged/success, 1 for drift and 2 for invalid/unreadable input.
This is a point-in-time check, not a lock against concurrent writers or proof of runtime behaviour.

Raw evidence may contain sensitive information. Private file permissions are not sanitisation.
Do not capture credentials unnecessarily or publish artifacts without explicit authorisation
and inspection. Hash-only untracked entries need materialisation if they matter to the review.
Ignored files, external state and nested submodule contents are outside the fingerprint.
Conflicts and working scopes containing submodules require separate evidence.
Git repositories without a commit also need manual before/after evidence.

## Checks

```sh
node --test home/.pi/agent/skills/dev-flow/scripts/snapshot-change.test.mjs
git diff --check
```

Use Pi's real skill loader to verify discovery, frontmatter and collision diagnostics after linking.
[Scenario checks](references/scenario-checks.md) describe behavioural acceptance cases.
Mechanical checks do not establish that these instructions improve model behaviour.

## Documentation basis

Validated against the installed Pi 1.0.4 documentation:
`docs/skills.md`, `docs/packages.md`, `docs/settings.md`, `docs/configuration.md` and
`docs/cli.md`, plus the installed pi-herdr-agents README and its bundled role definitions.
Recheck interfaces when upgrading. The native-directory layout follows this dotfiles repository's
AGENTS.md rather than creating a competing package installation.
