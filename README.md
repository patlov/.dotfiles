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

On macOS, `dot init` installs Homebrew when needed and uses it to install GNU Stow, GitHub CLI, Ghostty, Zed, and JetBrainsMono Nerd Font. On Arch Linux it installs the equivalent packages with `pacman`.

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

This command links only `home/.pi` into `~/.pi`, reuses Node.js 22.20 or newer when available, installs NVM plus the latest Node.js LTS only when needed, installs Pi and its dependencies, and links `dot` into `~/.local/bin`. It does not install Homebrew, system packages, Ghostty, Zed, fonts, Oh My Zsh, or change the login shell. Conflicting Pi files are backed up under `~/.dotfiles-backup/<timestamp>-pi/`.

The Pi configuration includes `pi-extmgr`, Plannotator, `/save-md`, Git editor/hook protections, staged secret scanning, and secret cloaking for tool output.

## Commands

```sh
dot init            # Complete setup; ask about GitHub SSH
dot init --ssh      # Complete setup and configure GitHub SSH
dot init --no-ssh   # Complete setup without GitHub SSH
dot install pi      # Install and configure only Pi
dot stow            # Re-link configuration
dot link            # Re-link the dot command
dot help            # Show command help
```
