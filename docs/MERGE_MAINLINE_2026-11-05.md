# 直接跟进主线：v0.3.3 迁移

## 固定范围

- 用户于 2026-11-05 确认完整迁移，对齐主线正式标签 v0.3.3：`f07b8965061bbc311ad7aa815879b09264a1e47d`。不合入标签后的 0.3.4 开发提交。
- 起点 `021fbf3fd319718c2b8c64c724fb546f2c3e0ff6`，完整包含 xinhai `3327c490`。原历史保留；备份分支 `backup/pre-mainline-migration-20261105`。
- 独立集成分支 `migration/mainline`；生产分支保持 `deployment/genshin`，推送目标仍为本 Fork 的 `main`。代码迁移不自动部署。

## 同步关系

| Remote | 仓库 | 用途 |
| --- | --- | --- |
| upstream | sganggs/Stronghold-Protocol | 直接合并来源、Issue 和贡献 PR 目标 |
| xinhai | xinhai-ai/Stronghold-Protocol | 历史来源与可选后续优化 |
| fork | ForkKILLET/Stronghold-Protocol | 本分支源码、PR 分支及部署来源 |

本地已将原 origin 重命名为 xinhai，新增 upstream，并把 GitHub CLI 的默认贡献目标设为主线。当前生产分支继续跟踪 fork/main。
GitHub 的 parent 元数据是 xinhai、source 是 sganggs；调整 Git remote 不会自动改变 parent。父仓库的人工 reroute 申请独立处理，不通过脱离 fork 网络或删除重建仓库实现。

## 保留和适配约定

主线玩法、模拟实现、官方多版本底座和对应数据/工具按固定版本合入。保留本分支 AGENTS.md 中明确的规则差异；不使用整文件 ours/theirs 解决共享文件。

- 服务端：完整 Match Worker、可靠状态增量、限额/会话归属、匹配与恢复、监控和独立管理员服务继续保留。
- 用户：SQLite 身份、四位公开 ID、公开档案、完整经营回放、逐回合作战统计及 outbox 保持长期数据；多版本使用实际内容身份，不用默认版解读其他版本。
- 前端：既有统一导航、移动缩放、聊天、字幕、快捷键和选择器保留，主线新功能接入这些组件。
- 资源：继续使用统一预载/ZIP、CDN、运行时配置和 Vite 按需构建；不重复引入独立素材下载器/导入器、素材哈希路由、CSP 或已排除的发行更新 ZIP。
- 发布：沿用维护等待/冷更新；运行态与长期账户分开处理，保留数据库、历史、回放、插件及资源卷。

## 合并前基线

起点完整 GitHub CI（Linux/Windows Node 22/24 和 tooling）5/5 成功：
https://github.com/ForkKILLET/Stronghold-Protocol/actions/runs/41677661731

独立工作树先准备依赖和 vendor，再验证配置、完整 Match Worker、账户、回放、资源及生产构建；初始化时未生成 vendor 的失败不属于代码基线缺陷。Node 22.23.3 的上述本地基线 67/67 通过，迁移约定文档检查 32/32 通过。

## 集成与验证进度

代码集成和最终验收尚未完成，不能将此记录作为 v0.3.3 已发布或已通过完整验证的证明。

## GitHub 父仓库申请草稿

Subject: Reroute an existing fork within the same fork network

Please change the immediate parent of https://github.com/ForkKILLET/Stronghold-Protocol from https://github.com/xinhai-ai/Stronghold-Protocol to https://github.com/sganggs/Stronghold-Protocol. All three repositories are already in the same fork network; sganggs/Stronghold-Protocol is its root source.

Please preserve the existing repository, commit history, branches, issues, pull requests (including upstream PRs #910 and #917), stars, releases, settings and integrations. This is not a request to detach or recreate the repository. If rerouting cannot preserve the existing metadata, please leave the relationship unchanged and let me know.
