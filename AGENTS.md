# Agent instructions

This is a public, cross-platform dotfiles repository. Keep changes portable, minimal, and free of credentials.

## Set up a machine

Choose one command based on the user's intent:

```sh
# Fresh macOS or Arch Linux development environment
./dot init

# Existing machine that only needs Pi and its configuration
./dot install pi

# Pull and apply the repository's recorded state
./dot update

# Re-link all tracked home configuration without reinstalling tools
./dot stow
```

Prefer `./dot install pi` on an already configured work machine. Do not run the full initializer unless the user asks for the complete environment. Existing conflicts are backed up under `~/.dotfiles-backup/`.

Use `./dot update --packages` only when intentionally upgrading Pi packages. It may change tracked manifests or lockfiles, which must be reviewed and committed separately.

## Repository conventions

- `home/` mirrors paths under `$HOME` and is linked with GNU Stow or the selective Pi linker.
- `home/.pi/agent/settings.json` is the portable Pi configuration.
- `home/.pi/agent/npm/package.json` and its lockfile track Pi package dependencies.
- `dot` is the only bootstrap entry point; keep it idempotent on macOS and Arch Linux.
- Treat the repository as public. Never add tokens, API keys, private keys, auth files, sessions, logs, sockets, caches, generated state, or machine-specific recovery journals.
- Mutable state belongs in the live home directory and must be excluded in `.gitignore`, not symlinked from this repository.
- Preserve conflicting user files through the existing backup behavior; never overwrite them silently.

## Pi changes

- Install or remove published Pi packages with `pi install` or `pi remove` so settings and npm manifests stay synchronized.
- Put original global extensions under `home/.pi/agent/extensions/`.
- Put reusable skills in `home/.pi/agent/skills/<name>/SKILL.md`; use `home/.pi/agent/prompts/<name>.md` only when a direct `/<name>` command is useful.
- Keep generated reports and other skill output outside the repository unless the user explicitly requests tracked artifacts.
- Do not copy unlicensed third-party extension source. Reimplement ideas independently.
- Keep credentials in environment variables or ignored local auth files.

## Validation

Run the checks relevant to the change:

```sh
bash -n dot
git diff --check
node --experimental-strip-types --test home/.pi/agent/extensions/safety/test/*.test.ts
npm audit --prefix home/.pi/agent/npm --omit=dev
pi --list-models >/dev/null
```

For installer changes, test with a temporary `HOME` and mocked external commands so the real machine is not modified.

Before committing, inspect `git status` and the staged diff for credentials and generated files. Stage files and commit in separate commands so the Git interceptor can scan the final index. Never use `--no-verify`.

## Documentation

Update `README.md` whenever setup behavior, supported platforms, installed applications, or public commands change.
