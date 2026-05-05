#!/usr/bin/env bash
set -euo pipefail

branch="open-source"
primary_remote="origin"
github_remote_url="https://github.com/DeerManSayNo/AIControls.git"
github_http_proxy="${GITHUB_HTTP_PROXY:-http://127.0.0.1:7897}"
push_remotes=("origin" "github")

push_branch() {
  local remote_name
  for remote_name in "${push_remotes[@]}"; do
    if [[ "${remote_name}" == "github" ]] && ! git remote get-url github >/dev/null 2>&1; then
      git remote add github "${github_remote_url}"
    fi
    if ! git remote get-url "${remote_name}" >/dev/null 2>&1; then
      echo "Remote '${remote_name}' not configured; skipping." >&2
      continue
    fi
    if [[ "${remote_name}" == "github" ]]; then
      git -c http.proxy="${github_http_proxy}" push -u "${remote_name}" "${branch}"
    else
      git push -u "${remote_name}" "${branch}"
    fi
  done
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 1
}

git checkout "${branch}" 2>/dev/null || git checkout -b "${branch}"
git pull --ff-only "${primary_remote}" "${branch}" || true

git add -A

if git diff --cached --quiet; then
  echo "Nothing staged to commit."
  push_branch
  git status --short --branch
  exit 0
fi

stat_line="$(git diff --cached --stat | awk 'END{print}')"
msg_subject="chore(${branch}): 更新代码（${stat_line}）"

git commit -m "$(cat <<EOF
${msg_subject}

EOF
)"

push_branch
git status --short --branch
