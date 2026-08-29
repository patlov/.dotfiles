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
git clone --recurse-submodules git@github.com:patlov/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
stow --target="$HOME" home
```

Install GNU Stow first when needed (`brew install stow` on macOS). If files already exist at their target paths, back them up before running Stow.

Pi package dependencies can be restored with:

```sh
cd ~/.pi/agent/npm
npm install
```
