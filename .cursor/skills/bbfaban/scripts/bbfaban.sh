#!/usr/bin/env bash
set -euo pipefail

DEST="${SYNC_RELEASE_DEST:-/Users/huanghaoqi/Documents/DeerManNotesAir/版本}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "error: run this script from inside the remind git repository." >&2
  exit 1
fi

RELEASE_DIR="${REPO_ROOT}/release"
LATEST_YML="${RELEASE_DIR}/latest-mac.yml"

if [[ ! -d "${RELEASE_DIR}" ]]; then
  echo "error: missing release dir: ${RELEASE_DIR}" >&2
  exit 1
fi

if [[ ! -f "${LATEST_YML}" ]]; then
  echo "error: missing ${LATEST_YML}" >&2
  exit 1
fi

VERSION="$(
  python3 - "${RELEASE_DIR}" <<'PY'
import re
import sys
from pathlib import Path

release = Path(sys.argv[1])
pattern = re.compile(r"^知忆笔记-(.+)-arm64\.dmg$")
candidates = []
for p in release.iterdir():
    if not p.is_file():
        continue
    m = pattern.match(p.name)
    if m:
        try:
            mtime = p.stat().st_mtime
        except OSError as e:
            sys.stderr.write(f"stat failed: {p}: {e}\n")
            sys.exit(1)
        candidates.append((mtime, m.group(1), p.name))

if not candidates:
    sys.stderr.write("no 知忆笔记-*-arm64.dmg found in release/\n")
    sys.exit(1)
# 按文件修改时间选最新；mtime 相同时按文件名稳定排序
mtime_ver_name = max(candidates, key=lambda t: (t[0], t[2]))
print(mtime_ver_name[1])
PY
)"

ARM64_DMG="${RELEASE_DIR}/知忆笔记-${VERSION}-arm64.dmg"
STANDARD_DMG="${RELEASE_DIR}/知忆笔记-${VERSION}.dmg"

if [[ ! -f "${ARM64_DMG}" ]]; then
  echo "error: expected file missing: ${ARM64_DMG}" >&2
  exit 1
fi

if [[ ! -f "${STANDARD_DMG}" ]]; then
  echo "error: expected file missing: ${STANDARD_DMG} (same version as arm64)" >&2
  exit 1
fi

mkdir -p "${DEST}"
find "${DEST}" -mindepth 1 -delete

cp -p "${LATEST_YML}" "${ARM64_DMG}" "${STANDARD_DMG}" "${DEST}/"

echo "ok: copied to ${DEST}"
echo "  - $(basename "${LATEST_YML}")"
echo "  - $(basename "${ARM64_DMG}")"
echo "  - $(basename "${STANDARD_DMG}")"
