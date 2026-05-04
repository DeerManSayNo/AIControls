---
name: commit-open
description: 将当前本地改动提交并推送到 open-source 分支（origin）。当用户说“提交到 open-source / 推到 open-source / 提交并推送开源分支”时使用。
disable-model-invocation: true
---

# commit-open

## 目标
- 切换到 `open-source`
- 拉取 `origin/open-source`（快进合并，避免改写历史）
- 暂存全部改动并提交
  - 若未提供提交说明：自动生成中文概括（基于 staged diff 统计）
- 推送到 `origin/open-source`

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/commit-open/scripts/commit-open.sh
```
---
name: commit-open
description: 将当前本地改动提交并推送到 open-source 分支（origin）。当用户说“提交到 open-source / 推到 open-source / 提交并推送开源分支”时使用。
disable-model-invocation: true
---

# commit-open

## 目标
- 切换到 `open-source`
- 拉取 `origin/open-source`（快进合并，避免改写历史）
- 暂存全部改动并提交
  - 若未提供提交说明：自动生成中文概括（基于 staged diff 统计）
- 推送到 `origin/open-source`

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/commit-open/scripts/commit-open.sh
```
