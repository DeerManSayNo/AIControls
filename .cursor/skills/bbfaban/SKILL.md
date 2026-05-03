* * *

## name: bbfaban

description: Empties /Users/huanghaoqi/Documents/DeerManNotesAir/版本 then copies the 知忆笔记 arm64/x64 DMG pair whose arm64 file has the latest filesystem mtime in release/, plus release/latest-mac.yml. Use when the user invokes bbfaban、同步 release 到 DeerMan、复制 dmg 到版本目录、清空版本目录并拷贝最新 mac 安装包, or asks to publish/sync Mac DMGs to DeerManNotesAir.

# 同步 release DMG 与 latest-mac.yml 到 DeerManNotesAir/版本（bbfaban）

## 目标路径（固定）

*   **目标目录**：`/Users/huanghaoqi/Documents/DeerManNotesAir/版本`
    
*   **源目录**：仓库根下的 `release/`（与 `latest-mac.yml` 同级）
    

## 必须复制的文件

1.  `release/latest-mac.yml`（始终复制当前仓库中的该文件）
    
2.  `release/知忆笔记-<version>-arm64.dmg`（在全部 arm64 DMG 中，选 **文件修改时间 mtime 最新** 的一条）
    
3.  `release/知忆笔记-<version>.dmg`（与上一条 **同一 version**，非 arm64 命名）
    

选型依据是 **mtime（内容更新/写入时间）**，不是文件名里的版本号大小。若需与 `latest-mac.yml` 内版本严格一致，应先保证构建产物时间与 yml 同步。

## 执行方式（优先）

在**仓库根目录**执行脚本（需本机有 `bash`、`python3`）：

bash

TEXT

```
bash .cursor/skills/bbfaban/scripts/bbfaban.sh
```

脚本会：

1.  `mkdir -p` 目标目录
    
2.  用 `find … -mindepth 1 -delete` **清空目标目录内所有内容**（含隐藏文件）
    
3.  在 `release/` 中按 **mtime** 选出最新的 `知忆笔记-*-arm64.dmg`，再校验同版本的 `知忆笔记-<version>.dmg` 存在
    
4.  复制上述两个 DMG 与 `release/latest-mac.yml` 到目标目录
    

若需覆盖目标路径（极少用）：

bash

TEXT

```
export SYNC_RELEASE_DEST="/path/to/other/dir"
bash .cursor/skills/bbfaban/scripts/bbfaban.sh
```

## 手工验收

*   目标目录内仅有 3 个文件：`latest-mac.yml`、对应版本的 arm64 DMG、对应版本的 DMG
    
*   两个 DMG 的版本号一致，且 arm64 对应文件为 `release/` 中 **mtime 最新** 的 `知忆笔记-*-arm64.dmg`
    

## 常见错误

*   **找不到 arm64 DMG**：`release/` 下尚未生成或未放入 `知忆笔记-*-arm64.dmg`
    
*   **缺少同版本非 arm64 DMG**：需存在 `知忆笔记-<version>.dmg`（不能只有 arm64）
    
*   **未在 git 仓库内执行**：脚本依赖 `git rev-parse --show-toplevel` 定位仓库根
    

## 可选说明

*   若用户明确要求**不**清空目标目录，则不要执行本 skill；本 skill 默认行为包含清空。