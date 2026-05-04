---
name: pull-open
description: 切换到 open-source 分支，从 origin 强制拉取并覆盖本地改动（包含删除未跟踪文件）。当用户说“同步 open-source / 拉取 open-source / 覆盖本地改动拉取”时使用。
disable-model-invocation: true
---

# pull-open

## 目标
- 切换到 `open-source`
- 从远端 `origin/open-source` 强制同步到本地
- **丢弃**本地已跟踪文件改动（reset --hard）
- **删除**未跟踪文件/目录（clean -fd）

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/pull-open/scripts/pull-open.sh
```

## 行为说明
- 这是破坏性操作：会丢弃本地未提交改动，并删除 untracked 文件。
- 同步完成后应输出 `git status --branch --short` 供确认。
---
name: pull-open
description: 切换到 open-source 分支，从 origin 强制拉取并覆盖本地改动（包含删除未跟踪文件）。当用户说“同步 open-source / 拉取 open-source / 覆盖本地改动拉取”时使用。
disable-model-invocation: true
---

# pull-open

## 目标
- 切换到 `open-source`
- 从远端 `origin/open-source` 强制同步到本地
- **丢弃**本地已跟踪文件改动（reset --hard）
- **删除**未跟踪文件/目录（clean -fd）

## 执行
在仓库根目录运行：

```bash
bash .cursor/skills/pull-open/scripts/pull-open.sh
```

## 行为说明
- 这是破坏性操作：会丢弃本地未提交改动，并删除 untracked 文件。
- 同步完成后应输出 `git status --branch --short` 供确认。
