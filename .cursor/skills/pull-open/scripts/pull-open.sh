#!/usr/bin/env bash
set -euo pipefail

branch="open-source"
remote="origin"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 1
}

git fetch "${remote}" "${branch}"

# Create/reset local branch to track remote branch.
git checkout -B "${branch}" "${remote}/${branch}"

# Discard local changes and delete untracked files.
git reset --hard "${remote}/${branch}"
git clean -fd

git status --short --branch
#!/usr/bin/env bash
set -euo pipefail

branch="open-source"
remote="origin"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 1
}

git fetch "${remote}" "${branch}"

# Create/reset local branch to track remote branch.
git checkout -B "${branch}" "${remote}/${branch}"

# Discard local changes and delete untracked files.
git reset --hard "${remote}/${branch}"
git clean -fd

git status --short --branch
