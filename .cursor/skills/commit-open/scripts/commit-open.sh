#!/usr/bin/env bash
set -euo pipefail

branch="open-source"
remote="origin"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 1
}

git checkout "${branch}" 2>/dev/null || git checkout -b "${branch}"
git pull --ff-only "${remote}" "${branch}" || true

git add -A

if git diff --cached --quiet; then
  echo "Nothing staged to commit."
  git status --short --branch
  exit 0
fi

stat_line="$(git diff --cached --stat | awk 'END{print}')"
msg_subject="chore(${branch}): 更新代码（${stat_line}）"

git commit -m "$(cat <<EOF
${msg_subject}

EOF
)"

git push -u "${remote}" "${branch}"
git status --short --branch
#!/usr/bin/env bash
set -euo pipefail

branch="open-source"
remote="origin"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 1
}

git checkout "${branch}" 2>/dev/null || git checkout -b "${branch}"
git pull --ff-only "${remote}" "${branch}" || true

git add -A

if git diff --cached --quiet; then
  echo "Nothing staged to commit."
  git status --short --branch
  exit 0
fi

stat_line="$(git diff --cached --stat | awk 'END{print}')"
msg_subject="chore(${branch}): 更新代码（${stat_line}）"

git commit -m "$(cat <<EOF
${msg_subject}

EOF
)"

git push -u "${remote}" "${branch}"
git status --short --branch
