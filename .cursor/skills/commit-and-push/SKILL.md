---
name: commit-and-push
description: 提交并推送所有已改动的代码到远程仓库。当用户要求提交、推送、提交并推送、同步代码、或说「帮我提交」「推一下」时使用。Commits and pushes all changed files. Use when the user asks to commit, push, submit changes, or sync code to remote.
---

# 提交并推送代码

## 执行流程

1. **查看状态**：先执行 `git status`，确认有哪些改动（未跟踪、已修改、已暂存）。
2. **暂存全部**：执行 `git add -A`（或 `git add .`）暂存所有改动。
3. **提交**：
   - 若用户已给出提交说明，使用该说明：`git commit -m "用户提供的说明"`。
   - 若未给出，根据 `git status` 与 `git diff --staged --stat` 生成简短中文或英文说明（一句概括改动目的），再执行 `git commit -m "生成的说明"`。
4. **推送**：执行 `git push`。若提示未设置上游分支，使用 `git push -u origin <当前分支名>`。
5. **更新发布说明**：推送成功后，执行 [update-release-notes](.cursor/skills/update-release-notes/SKILL.md) 的流程：运行 `bash .cursor/skills/update-release-notes/scripts/generate-release-notes.sh`，将输出写入 `src/release-notes.json` 的 `releaseNotes` 字段。

## 提交说明规范

- 项目规则：提交信息可用中文或英文，描述清楚修改内容和影响范围。
- 建议格式：`类型或动词 + 简要描述`，例如：`fix: 修复签名校验在 Safari 下的问题`、`feat: 新增反馈接口与数据库迁移`。

## 异常处理

- **无改动**：若 `git status` 显示 "nothing to commit, working tree clean"，告知用户当前没有可提交的改动，无需执行 add/commit/push。
- **推送失败**：若 `git push` 因冲突或权限失败，将错误信息转述给用户，不自动执行 `git pull --rebase` 或强制推送，除非用户明确要求。
- **未配置远程**：若提示 no remote，告知用户需要先添加 remote（如 `git remote add origin <url>`）。

## 注意事项

- 仅提交与推送，不自动执行 `git pull`、`rebase`、`reset` 等会改写历史的操作。
- 一次改动聚焦一个目的；若用户希望拆成多次提交，按用户指示拆分后再分别 commit 与 push。
