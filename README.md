# .dotfiles

Personal configuration for macOS and Linux, stored in a `home/` tree inspired by [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles).

## Layout

- `home/.config/` — application configuration, including Herdr
- `home/.pi/agent/` — portable pi settings, skills, extensions, themes, and package manifests
- `home/.zshrc` — Zsh configuration
- `iterm_profile.json` — iTerm profile export

Credentials, sessions, logs, sockets, caches, dependencies, and generated state are intentionally excluded.

## Install

```sh
git clone https://github.com/patlov/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./dot init
```

On macOS, `dot init` installs Homebrew when needed and uses it to install GNU Stow, GitHub CLI, Ghostty, Zed, JetBrainsMono Nerd Font, SoX, and whisper.cpp. On Arch Linux it installs the equivalent packages with `pacman`.

The command also:

- links the `home/` configuration tree;
- installs Oh My Zsh with autosuggestions and syntax highlighting;
- sets Zsh as the default login shell;
- configures Ghostty to use JetBrainsMono Nerd Font;
- installs NVM and the latest Node.js LTS release;
- installs Pi and restores its configured packages and extension dependencies;
- asks whether to generate and upload an Ed25519 GitHub SSH key; and
- installs `dot` into `~/.local/bin`.

Existing files at managed target paths are never overwritten. Matching files are replaced with links, while conflicting files are preserved under `~/.dotfiles-backup/<timestamp>/` before linking.

## Install only Pi

On an existing work machine where the development tools are already installed:

```sh
git clone https://github.com/patlov/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./dot install pi
```

This command links only `home/.pi` into `~/.pi`, reuses Node.js 22.20 or newer when available, installs NVM plus the latest Node.js LTS only when needed, installs Pi and its dependencies, and links `dot` into `~/.local/bin`. It does not install Homebrew, Ghostty, Zed, fonts, Oh My Zsh, or change the login shell. It does install the local-dictation system packages through an existing Homebrew or Arch `pacman` installation. Conflicting Pi files are backed up under `~/.dotfiles-backup/<timestamp>-pi/`.

The Pi configuration includes `pi-extmgr`, Plannotator, `/save-md`, Git editor/hook protections, staged secret scanning, secret cloaking for tool output, and private local voice dictation. MCP uses Pi's built-in support; the external `pi-mcp-adapter` package is not required.

A local [Claude Code bridge](home/.pi/agent/extensions/pi-claude-bridge/README.md) also provides `claude_task_*` tools for new, visible Claude sessions inside Herdr. It requires a separately installed and authenticated Claude Code CLI and explicit launch confirmation; installing the dotfiles does not launch Claude. Native Claude permissions apply, not Pi's tool/secret guards. Its generated `.claude-bridge/` state is private and ignored by Git; do not publish or symlink it as configuration.

Select `/model router/auto` to plan on `anthropic/claude-opus-5-5`. On each user turn while planning, an authenticated Jev classifier checks whether implementation should begin; explicit implementation approval switches to `openai-codex/gpt-6.1-sol`. Implementation stays on Sol without further classification until `/router plan` restores planning. The footer shows the current phase; phase changes follow the session branch and survive reloads. Tool continuations and retries keep their model. Requires both chat providers and a Jev provider, such as TypeSafe or OpenRouter. The extension lives in `home/.pi/extensions.router.ts` and is linked into the extensions directory; it does not change the default model.

Test the router without live model calls:

```sh
node --experimental-strip-types --test home/.pi/agent/extensions/router/test/*.test.ts
```

Local dictation uses SoX plus `whisper.cpp` with the quantized Whisper Large-v3-Turbo model. Press `ctrl+space` to start or stop recording and `ctrl+shift+space` to cancel. The model server starts on the first dictation, stays warm for 30 minutes after activity, and stops when Pi exits. Audio remains on the machine. The installer downloads the checksum-verified 547 MB model into untracked user data under `~/.local/share/pi-local-dictate/`.

Two reusable skills also provide browsable local reports:

```text
/architecture-review [scope]  # Review blockers, architecture fit, and overengineering
/generate-html <request>      # Generate a standalone HTML explanation or report
```

The generated pages are self-contained and stored under `~/.pi/agent/generated-html/`. The skills are also available through `/skill:architecture-review` and `/skill:generate-html`.

Four opt-in development skills reuse Pi/Herdr and each repository's verification guidance:

```text
/skill:dev-flow implement ASK-1234. Verify locally; do not push.
/skill:blast-radius inspect the safety assumptions behind this change.
/skill:design-arena compare designs for an unresolved architectural decision.
/skill:prevent-repeat propose enforcement for this recurring agent mistake.
```

`dev-flow` accepts Linear tickets through an existing integration or pasted implementation briefs.
It chooses proportionate design and risk checks; small changes do not require subagents.
The skills grant no publishing, shared-data or deployment permissions. Prevention is proposal-only
until approved. All four are explicit-invocation skills, not an always-on mode. Run `/reload` after
linking them. See [development flow](home/.pi/agent/skills/dev-flow/README.md) for usage, the private
Git evidence helper, verification limits and checks.

## Update

```sh
dot update             # Pull and apply the repository's recorded state
dot update --packages  # Also upgrade configured Pi packages
```

A normal update requires a clean dotfiles worktree, pulls with `--ff-only`, updates submodules, links any new Pi configuration, restores locked dependencies, and refreshes the `dot` link. Existing symlinked non-Pi configuration updates automatically when the repository changes; run `dot stow` if an update adds a new non-Pi home file.

Package upgrades are opt-in because they may modify the tracked Pi package manifest or lockfile. Review and commit those changes after `dot update --packages`.

## Commands

```sh
dot init            # Complete setup; ask about GitHub SSH
dot init --ssh      # Complete setup and configure GitHub SSH
dot init --no-ssh   # Complete setup without GitHub SSH
dot install pi      # Install and configure only Pi
dot update          # Pull and apply recorded updates
dot update --packages # Also upgrade Pi packages
dot stow            # Re-link configuration
dot link            # Re-link the dot command
dot help            # Show command help
```
