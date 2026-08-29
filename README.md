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
git clone git@github.com:patlov/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./dot init
```

`dot init` initializes Git submodules, installs GNU Stow through Homebrew when needed, links the `home/` tree, restores Pi dependencies, and installs `dot` into `~/.local/bin`.

Existing files at managed target paths are never overwritten. Matching files are replaced with links, while conflicting files are preserved under `~/.dotfiles-backup/<timestamp>/` before linking.

## Commands

```sh
dot init   # Complete setup
dot stow   # Re-link configuration
dot link   # Re-link the dot command
dot help   # Show command help
```
