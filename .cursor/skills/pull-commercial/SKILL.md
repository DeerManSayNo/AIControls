---
name: pull-commercial
description: 切换到 commercial 分支，从 origin 强制拉取并覆盖本地改动（包含删除未跟踪文件）。当用户说“同步 commercial / 拉取 commercial / 覆盖本地改动拉取”时使用。
disable-model-invocation: true
---

# pull-commercial

## 目标
- 切换到 `commercial`
- 从远端 `origin/commercial` 强制同步到本地
- **丢弃**本地已跟踪文件改动（reset --hard）
- **删除**未跟踪文件/目录（clean -fd）

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/pull-commercial/scripts/pull-commercial.sh
```

## 行为说明
- 这是破坏性操作：会丢弃本地未提交改动，并删除 untracked 文件。
- 同步完成后应输出 `git status --branch --short` 供确认。
---
name: pull-commercial
description: 切换到 commercial 分支，从 origin 强制拉取并覆盖本地改动（包含删除未跟踪文件）。当用户说“同步 commercial / 拉取 commercial / 覆盖本地改动拉取”时使用。
disable-model-invocation: true
---

# pull-commercial

## 目标
- 切换到 `commercial`
- 从远端 `origin/commercial` 强制同步到本地
- **丢弃**本地已跟踪文件改动（reset --hard）
- **删除**未跟踪文件/目录（clean -fd）

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/pull-commercial/scripts/pull-commercial.sh
```

## 行为说明
- 这是破坏性操作：会丢弃本地未提交改动，并删除 untracked 文件。
- 同步完成后应输出 `git status --branch --short` 供确认。
