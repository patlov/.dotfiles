#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  worktree-review.sh prepare <remote-branch>
  worktree-review.sh cleanup-success <worktree-path>
  worktree-review.sh cleanup-failed <worktree-path>
  worktree-review.sh prune
EOF
  exit 2
}

repo_root() {
  git rev-parse --show-toplevel
}

review_root() {
  local root config_root repo_name repo_key
  root="$(repo_root)"
  config_root="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  repo_name="$(basename "$root")"
  repo_key="$(printf '%s' "$root" | shasum -a 256 | cut -c1-12)"
  printf '%s/worktrees/reviews/%s-%s\n' "$config_root" "$repo_name" "$repo_key"
}

assert_review_path() {
  local root="$1"
  local path="$2"

  case "$path" in
    "$root"/*) ;;
    *)
      printf 'Refusing path outside the review root: %s\n' "$path" >&2
      exit 2
      ;;
  esac
}

is_clean_worktree() {
  local path="$1"
  [[ -z "$(git -C "$path" status --porcelain --untracked-files=all)" ]]
}

prune_reviews() {
  local root path marker
  root="$(review_root)"
  mkdir -p "$root"
  git worktree prune

  for path in "$root"/*; do
    [[ -d "$path" ]] || continue
    marker="${path}.active"

    if [[ -f "$marker" ]]; then
      if [[ -z "$(find "$marker" -mmin +1440 -print -quit)" ]]; then
        printf 'SKIPPED_ACTIVE=%s\n' "$path"
        continue
      fi
      rm -f "$marker"
    fi

    if ! git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      printf 'RETAINED_UNREGISTERED=%s\n' "$path"
      continue
    fi

    if ! is_clean_worktree "$path"; then
      printf 'RETAINED_DIRTY=%s\n' "$path"
      continue
    fi

    if git worktree remove "$path"; then
      printf 'PRUNED=%s\n' "$path"
    else
      printf 'RETAINED_REMOVE_FAILED=%s\n' "$path" >&2
    fi
  done

  git worktree prune
}

prepare() {
  local branch="$1"
  local root reviews slug run_id path target_commit

  git check-ref-format "refs/heads/$branch" >/dev/null || {
    printf 'Invalid branch name: %s\n' "$branch" >&2
    exit 2
  }

  root="$(repo_root)"
  reviews="$(review_root)"
  prune_reviews

  git fetch --no-tags origin "refs/heads/$branch"
  target_commit="$(git rev-parse FETCH_HEAD)"
  git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"

  slug="$(printf '%s' "$branch" | tr '/[:space:]' '--' | tr -cd '[:alnum:]_.-')"
  run_id="$(date '+%Y%m%d-%H%M%S')-$$-${RANDOM}"
  path="$reviews/$slug-$run_id"

  git worktree add --detach "$path" "$target_commit"
  touch "${path}.active"

  printf 'WORKTREE_PATH=%s\n' "$path"
  printf 'TARGET_COMMIT=%s\n' "$target_commit"
  printf 'BASE_REF=origin/main\n'
}

cleanup_success() {
  local path="$1"
  local root
  root="$(review_root)"
  assert_review_path "$root" "$path"
  rm -f "${path}.active"

  if [[ ! -d "$path" ]]; then
    printf 'ALREADY_REMOVED=%s\n' "$path"
    return
  fi

  if ! is_clean_worktree "$path"; then
    printf 'RETAINED_DIRTY=%s\n' "$path"
    return
  fi

  git worktree remove "$path"
  git worktree prune
  printf 'REMOVED=%s\n' "$path"
}

cleanup_failed() {
  local path="$1"
  local root
  root="$(review_root)"
  assert_review_path "$root" "$path"
  rm -f "${path}.active"
  printf 'RETAINED_FAILED=%s\n' "$path"
}

[[ $# -ge 1 ]] || usage
command="$1"
shift

case "$command" in
  prepare)
    [[ $# -eq 1 ]] || usage
    prepare "$1"
    ;;
  cleanup-success)
    [[ $# -eq 1 ]] || usage
    cleanup_success "$1"
    ;;
  cleanup-failed)
    [[ $# -eq 1 ]] || usage
    cleanup_failed "$1"
    ;;
  prune)
    [[ $# -eq 0 ]] || usage
    prune_reviews
    ;;
  *) usage ;;
esac
