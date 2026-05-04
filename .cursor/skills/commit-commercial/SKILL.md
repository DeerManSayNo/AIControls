---
name: commit-commercial
description: 将当前本地改动提交并推送到 commercial 分支（origin）。当用户说“提交到 commercial / 推到 commercial / 提交并推送商业分支”时使用。
disable-model-invocation: true
---

# commit-commercial

## 目标
- 切换到 `commercial`
- 拉取 `origin/commercial`（快进合并，避免改写历史）
- 暂存全部改动并提交
  - 若未提供提交说明：自动生成中文概括（基于 staged diff 统计）
- 推送到 `origin/commercial`

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/commit-commercial/scripts/commit-commercial.sh
```
---
name: commit-commercial
description: 将当前本地改动提交并推送到 commercial 分支（origin）。当用户说“提交到 commercial / 推到 commercial / 提交并推送商业分支”时使用。
disable-model-invocation: true
---

# commit-commercial

## 目标
- 切换到 `commercial`
- 拉取 `origin/commercial`（快进合并，避免改写历史）
- 暂存全部改动并提交
  - 若未提供提交说明：自动生成中文概括（基于 staged diff 统计）
- 推送到 `origin/commercial`

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/commit-commercial/scripts/commit-commercial.sh
```
