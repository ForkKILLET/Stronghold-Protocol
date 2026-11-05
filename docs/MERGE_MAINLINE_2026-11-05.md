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
- 资源：继续使用统一预载/ZIP、CDN、运行时配置和 Vite 按需构建；不重复引入独立素材下载器/导入器、素材哈希路由、CSP；保留已有发行打包工具，但不新增启动时自动应用 ZIP／删除旧文件的流程。
- 发布：沿用维护等待/冷更新；运行态与长期账户分开处理，保留数据库、历史、回放、插件及资源卷。

## 合并前基线

起点完整 GitHub CI（Linux/Windows Node 22/24 和 tooling）5/5 成功：
https://github.com/ForkKILLET/Stronghold-Protocol/actions/runs/41677661731

独立工作树先准备依赖和 vendor，再验证配置、完整 Match Worker、账户、回放、资源及生产构建；初始化时未生成 vendor 的失败不属于代码基线缺陷。Node 22.23.3 的上述本地基线 67/67 通过，迁移约定文档检查 32/32 通过。

## 集成结果

本次保留真实双亲合并，不重建仓库，不改写迁移前的提交。主线新增的玩法修复、四个官方版本、版本投票、观战者接替 AI、测试对局、界面手动缩放及相关提取/打包工具按 v0.3.3 接入；没有追入 dev。

| 领域 | 适配结果 |
| --- | --- |
| 状态传输 | 沿用本分支主线程发送队列和 Worker 编码，接上主线分流序号、全量恢复和过期包保护；修复 resync 分支不存在的 answer 调用。 |
| 多版本 | 默认仍为第二期下半；历史版本使用独立内容 Host，版本身份贯通房间、同版本检查点、结算、公开记录和完整回放。公共匹配仍只接受本服默认规则。 |
| AI 接替 | 投票授权后在对局所属 Worker 内接替席位，再更新连接、账户归属及房间；原阵容和经营状态保留，重连使用新的真人席位。 |
| 统计和回放 | SQLite 及公开档案统计按版本汇总；测试/中途接替记录按主线规则排除累计。保留四位公开 ID、恢复码、完整经营过程、固定/公开控制和逐回合伤害。旧记录无 version 时仍是原默认版本。 |
| 公开回放链接 | 独立档案通过 HTTP 获取版本清单，无需账户或 WS；公开/私人回放响应按记录版本给出当前规则指纹，历史战斗使用已校验的对应内容集，不拿默认数据重演。 |
| 皮肤 | 普通干员使用跨版本 charId，DIY 保留独立槽位；原本机选择延迟迁移并按当前版本过滤。头像缩略图和立绘共用归属规则、显示开关及默认图回退。房间立绘继续独立。 |
| 局外界面 | 保留本服首页、统一顶栏、档案、调配双模式和自定义下拉。版本切换/AI 接替放入“调整配置”，避免挤满手机房间底栏；短屏立绘保持 1:2 和最小宽度，就绪状态移至名牌。 |
| 设置 | 接入上游手动 75–100% 缩放和屏幕边缘适配，默认 100%；局外自动设计单位和正式对局 rem 仍各自管理，安全区只应用一次。合并弹药/能量显示开关；部署镜头仍是本服 opt-in。 |
| 资源 | 补齐四版本普通素材并接入官方策略徽章/统计模板素材的现有下载计划；统一预载/ZIP/CDN 继续生效。普通下载只新增文件，不覆写本机旧 Spine。 |

普通素材清单现包含 229 名干员、258 种敌人、58 种召唤物记录、716 份网页 Spine 模型和 639 个 UI 素材。所有清单文件均核对实际字节存在。已有本地提取的 39 种召唤物模型也可继续使用；场景是可选提取资源，缺少官方场景时沿用金属地块回退，不将其表述为全部官方场景已补齐。

### 明确保留的分支差异

- 本服旧 SfxLimiter 及战场声音清理继续使用；不接入主线客户端 bank/pool 播放器。生成音效清单可保留上游的静态参数，不改变播放生命周期。
- 不恢复独立“下载完整素材”/素材包导入器、素材哈希路由、启动自动应用 ZIP、CSP 或 no-eval 适配。
- 保留赠送/控制台装备来源库存、Boss 存活人数缩放、联防地图、经营计数、聊天、字幕、快捷键及原 PixBot 提示。
- 主线默认房间快照夹具加入本分支原有 matching/console/prep/speed 字段，四个版本名单和默认版本均不变。头像目录、皮肤目录、术语属于展示文件，不参与玩法 cs。
- 主线只适用于新首页、单一调配卡片、Modal 形式 S.W.E.E.P.、加号 HUD 间隔和新音频池的源码/几何断言不适用于本服的保留布局；对应断言逐项移除，通用功能测试保留。替代验证使用本服调配/档案/顶栏测试以及 Chrome/Firefox 的实际页面截图和几何测量。
- 手动缩放的 CSS 守卫保留迁移前已有的触控/可读性尺寸下限，已列入固定夹具；新增声明继续接受上游缩放约束，正式对局不应用局外自动缩放。

## 验证记录

以下是已完成的集成验收证据；代码迁移与生产发布分开：

- Node 22.23.3 完整确定性基准：roster 49、bonds 46、fields 22、matches 21、standins 10、DIY 140 全部通过。13 个本服规则差异样例的输出均逐项审阅，没有模拟/调度错误。
- 生产客户端 Chrome/Firefox：创建、满员房间、配置、确认、策略、档案，桌面/短横屏/安全区/大字号及 75% 手动缩放通过截图和测量；实际设置控件和切换第一期房间也通过。
- 生产客户端 Chrome/Firefox：真实录制、SQLite 入库、完整经营时间线、历史回放、公开/固定操作和战斗播放通过。
- 独立公开第一期回放在 Chrome/Firefox 验证准备/战斗、实际模型、返回后恢复默认数据；确认零 WS 连接、零私人账户请求。公开/私人历史回放均返回对应版本的当前规则指纹；SQLite 公开统计按版本隔离且继续遵守隐私开关。
- 新增真实 WS + 完整 Match Worker 接替/重连、历史版本检查点恢复，以及 SQLite 关闭重开后的多版本统计/回放隐私回归。
- 构建、类型检查和 CI 分片守卫通过；ESLint 无错误，保留上游及本分支现有警告。导入边界工具保持既有行为，仅报告 Node 专用 nodeData.js 的三个内置导入，浏览器构建继续排除它。
- 带双报告器的全量运行没有产生完整结束汇总，不记为整套通过。已完成的案例保留原始证据；资源/字幕、主线源码约束及 Worker 差异逐项修复，按文件定向复验。不得把中断报告或缺失结尾当成成功。
- 依据本机 devops 的 OOM 分析增加 `check:local`：独立 scope、6/8 GiB 内存软/硬限额、512 MiB swap、2 GiB Node 堆、共享锁与本机串行；定向复验可选更小的 4 GiB 整组/1 GiB 堆预算。实测 cgroup 已离开 Paseo，oom.group=1；没有通过制造 OOM 测试限制。
- Worker、CI 入口和字幕覆盖在限额内定向回归 69/69 通过；插件恢复测试已独立重跑两次通过。保留 fork 的默认 CPU 线程预算及 lane 结构，不为适配主线的 opt-in 测试改变生产默认值。
- 最后一轮类型/ESLint 和账户/回放/CI 定向回归 47/47 通过；资源及 Spine 实际解析回归 81/81 通过。限制内构建单独峰值约 1.22 GiB，最终构建加双浏览器任务峰值约 1.47 GiB，memory.events 的 max/oom/oom_kill 均为零。

本次不启动生产部署。后续发布仍需按既有脚本等待空服并冷更新；不得删除账户库、回放、未入库结算或长期历史。

## GitHub 父仓库申请草稿

用户已授权申请，随后选择自行在 Firefox 填写；本次未代为提交。

Subject: Reroute an existing fork within the same fork network

Please change the immediate parent of https://github.com/ForkKILLET/Stronghold-Protocol from https://github.com/xinhai-ai/Stronghold-Protocol to https://github.com/sganggs/Stronghold-Protocol. All three repositories are already in the same fork network; sganggs/Stronghold-Protocol is its root source.

Please preserve the existing repository, commit history, branches, issues, pull requests (including upstream PRs #910 and #917), stars, releases, settings and integrations. This is not a request to detach or recreate the repository. If rerouting cannot preserve the existing metadata, please leave the relationship unchanged and let me know.
