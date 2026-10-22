# 上游与活跃分支进展（2026-10-23）

截至北京时间 2026-10-23 凌晨。核对 GitHub 当前分支头、发布记录与提交历史，枚举 API 可见的 350 个直接 fork，抽查 20 个仓库，并进一步检查此前关注仓库的非默认分支。`pushed_at` 包含向其他分支推送，不能视为默认分支有新功能。以下是源码／文档调查，未对第三方版本作运行验收，也未合并或部署它们。

## 版本与本分支的位置

| 来源 | 当前位置 | 状态 |
| --- | --- | --- |
| [主线正式发布](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.3.1) | `v0.3.1`，`b3deebdae4` | 北京时间 10-18 发布；最新正式版仍是 0.3.1 |
| [主线 master](https://github.com/sganggs/Stronghold-Protocol/commit/c9d804f470b8) | `c9d804f470b8`，10-18 19:50 | 发布后已有少量修复；提交标题提到 0.3.2，不代表已发布该版本 |
| [主线 dev](https://github.com/sganggs/Stronghold-Protocol/commit/218647c6e075) | `218647c6e075`，10-21 21:39 | 0.3.2 开发中，含较多渲染和外部 AI 更新 |
| [xinhai master](https://github.com/xinhai-ai/Stronghold-Protocol/commit/e01036ae62ac) | `e01036ae62ac`，10-18 14:46 | 仍以 0.3.0 为基础，继续优化后端、存档和资源 |

本分支上次整体同步 xinhai 的基点是 `5160d018`；其后新增的六个 xinhai 提交未按原提交合入。本地已经独立改造手机缩放、导航、预载和账户系统，不能把上游同名功能一概视为缺失。主线历史中还包含我们明确排除的独立素材导入／下载流程，不能用“落后多少提交”衡量实际功能差距。

## 主线：0.3.1 与 0.3.2

[0.3.1 发布说明](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.3.1)的主要方向：

- **规则修正**：联防只结算漏入波次；凯瑟琳的突变细胞每人每局限领取一次；琳琅诗怀雅三技能满币后不再自动关闭和爆发。这类规则修复应优先核对与同步。
- **插件和工作台**：扩展 Forge 导入、九类图形模板、声明式特质与交互窗口、四类房间规则、按席位皮肤、池外官方干员，以及不计统计的测试房间／战斗控制台。插件身份计算也有调整，合并时须同时检查内容哈希、Worker、恢复与服务器统计。
- **画面和声音**：大量官方特效、持续区域、技能动作、攻击／命中音库修复；场景保留自发光和无损贴图并去重。场景提取版本变化涉及重新提取与预载包重建，不能只更新 JS。
- **界面**：官方结算／机变／提示动画、异形屏适配、SWEEP 等。我们已使用部分前身设计并持续重做布局，应按具体行为补齐，不整页覆盖。

[dev 的更新日志](https://github.com/sganggs/Stronghold-Protocol/blob/218647c6e075/CHANGELOG.md)在 0.3.1 之上继续推进：

- **渲染稳定性**：战斗结束恢复待机并清理残留特效；冷启动／重新进入退回简化棋盘后自动重试；修正更多技能攻击片段。图片时装可只换头像与立绘、保留默认战斗模型。
- **便利读数**：可选的萨尔贡／叙拉古效果倒计时，策略选择时查看本局敌人，手机横屏战斗统计按 HUD 比例缩放。
- **规则和引擎**：野鬃二技能背面推力改为径向；修复移除增益回调的重入问题；官方边界扫描复用正则读取器。
- **外部 AI**：策略接口、HTTP／stdio 接入、失败回退、逐局回放和基准；进一步提供每回合计划、知识包及语言模型顾问示例。默认仍用原 AI，不意味着联网部署已经需要或启用了模型服务。
- **工程**：可配置容量上限、启动时打印有效限制、Windows 路径和 Python 3.8 兼容修复。我们的容量限制已有实现，应对齐语义而非重复添加。

## xinhai：六个新提交

| 提交 | 内容 | 对本分支的意义 |
| --- | --- | --- |
| [`891489f2`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/891489f2) | 清单编码、插件扫描、状态编码等后台任务 | 值得审阅，重点检查现有 Worker、增量消息和管理面板的数据来源 |
| [`506d297a`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/506d297a) | 手机设置测试改用设计单位 | 我们已有完整手机布局改造，只按当前布局保留有意义的测试 |
| [`e519d29f`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/e519d29f) | 官方特效资源走 CDN | 核对普通素材、VFX、插件素材的 URL／缓存归属，适合单独修补 |
| [`90facfba`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/90facfba) | 在线接入上限、单人断线六小时回收 | 属于部署策略变化；不能顺带把我们原有恢复窗口改短 |
| [`d92d2641`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/d92d2641) | 过期 recovery 回收、周期保存批处理 | 当前用户量下可作为后续性能维护；保留有效缺内容的恢复记录及账户结算 outbox |
| [`e01036ae`](https://github.com/xinhai-ai/Stronghold-Protocol/commit/e01036ae) | 存档元数据分批传输，减少主线程连续复制 | 不改 Redis JSON 格式的优化方向，与我们减少格式分歧的原则一致 |

其[性能文档](https://github.com/xinhai-ai/Stronghold-Protocol/blob/e01036ae62ac/docs/BACKEND_PERFORMANCE.md)明确区分本地微基准与线上负载，没有宣称所有卡顿都由存档造成。另有默认保存周期从 10 秒改为 30 秒、退出等待延长等配套策略；合入前应分别决定，不能让性能提交隐式改变耐久窗口或容器停止时限。

## 有独立进展的分支

| 仓库／实际分支 | 最近确认的内容 | 跟进建议 |
| --- | --- | --- |
| [kanomahoro1224：perf 分支](https://github.com/kanomahoro1224/Stronghold-Protocol/commit/06da390e027a) | 10-21：直接透传 Worker 已编码帧、公开状态增量；另有持久化批处理、后台任务和模拟池 | 与我们和 xinhai 的后端高度重叠。逐路径比较，可优先检查重复编码，避免并存两套传输／持久化机制 |
| [zasx77771：增强版](https://github.com/zasx77771/Stronghold-Protocol-Enhanced/tree/ds-enhanced-mode) | 10-22：Android TCP 快通道、协议切换立即重连、修正邀请地址；增强版自有发布编号，不能与主线版本号混同 | 客户端壳专用逻辑不直接加入浏览器服务器 |
| [zasx77771：重刷](https://github.com/zasx77771/Stronghold-Protocol-Enhanced/commit/d7089257)／[CI](https://github.com/zasx77771/Stronghold-Protocol-Enhanced/commit/7b39fbc6) | 10-21～22：任意入座玩家发起／取消开局重刷、请求／冷却和观战投票展示；按实测耗时做四片 CI | 我们已有重刷投票，需比较权限和取消语义；CI 分片值得单独评估，不能直接照抄测试清单 |
| [Convey123：魔王微尘](https://github.com/Convey123/Stronghold-Protocol/commit/6dd16c67abd8)／[宴音效](https://github.com/Convey123/Stronghold-Protocol/commit/4f4ea1e7fd) | 10-21～22：补魔王微尘环绕显示、修宴二技能命中音 | 较聚焦的候选；微尘也改模拟事件／快照，音效涉及提取工具，均需配套验收 |
| [Stardust-minus](https://github.com/Stardust-minus/Stronghold-Protocol/commit/3dbdbc25c9) | 10-18：同步 0.3.1，集群导出适配；素材批量签名、私有 ModelScope 数据集 | 主要是它自己的集群和素材分发方案。我们已有预载包／CDN，不直接替换 |
| [2321Robin：local-preview](https://github.com/2321Robin/Stronghold-Protocol/commit/40a48e2f76e2) | 10-18：0.3.1 加六个 mod 的部署产物及资源包更新；`feat/mods-024` 留有独立 mod／测试框架 | 注意其 mod 层与上游插件不是同一种接入方式；新内容优先考虑按上游插件格式移植 |
| [YinqiMargatroid：六人版](https://github.com/YinqiMargatroid/Stronghold-Protocol-Six-Player/commit/7366c68920) | 六人流程同步 0.3.1；另有寄生宿主、预生成商店、跨场技能等修复分支 | 六人扩容会影响配对、库存、生命、地图和 UI，不宜直接接受；独立规则修复可单审 |
| [YuriRestia：dev-0.2](https://github.com/YuriRestia/Stronghold-Protocol-EN-translation/tree/dev-0.2) | 10-20～21：英文反馈模板、类型／CI／发布平台测试修复及 PR 集成 | 适合关注翻译和测试质量，继续保留我们的完整英文词条检查 |
| [TempesTKF](https://github.com/TempesTKF/Stronghold-Protocol/commit/1540c0d62e) | 10-22：Touch 策略专用 AI；此前有独立管理台、公告和玩家管理 | AI 可作后续参考；我们已具备独立管理容器和通知，无须重做 |
| [DoveK0908：Pro](https://github.com/DoveK0908/Stronghold-Protocol-Pro/commit/245f8e419d) | 10-22：方向性特效、预乘透明度、模型枪口／出手点、结算 Boss 伤害统计 | 可筛选可复现的显示修复，先核对其来源与主线是否已有等价修正 |
| [Stronghold-Protocol-agent](https://github.com/Stronghold-Protocol-agent/Stronghold-Protocol/commit/fb888910753e) | 10-22：可选无损 PNG 特效贴图；另有房间进程、模拟并发许可、信任等级、状态增量实验 | PNG 选项是素材提取候选；进程和校验架构与当前完整 Match Worker 重叠，先不引入另一套 |
| [ArkStrongholdRL](https://github.com/ArkStrongholdRL/Stronghold-Protocol/commit/08d53827862e) | 10-21：真人轨迹和控制来源标识、优先运行素材缓存、模拟打包 | 是 AI 数据采集／训练方向；采集不是我们当前服务器的默认功能，不随普通更新引入 |

其他值得知道的方向：[L-xuanxiao 的 Android 离线包与压缩评估](https://github.com/L-xuanxiao/Stronghold-Protocol/tree/xx/android)、[UNDFFIO 的藏品／刮刮票玩法](https://github.com/UNDFFIO/Stronghold-Protocol-dlc/commit/cf0988361a)、[Rhine 的扩展干员／装备](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/commit/f59f1e81ba)、[arkpedia 的本篇关卡模拟器](https://github.com/arkpedia/arkpedia-stage-simulator/commit/8d1427f317)。后几类已经改变内容或产品方向，不能当作原版修复整体合入。

## 建议的下一步

1. **先做主线规则与稳定性同步**：固定 0.3.1 正式版和已选的 0.3.2 修复，核对联防、凯瑟琳、琳琅诗怀雅、野鬃、特效清理、加载超时恢复及增益重入。保留我们的顶栏／聊天／计数／字幕／档案／预载 UI；统计、Worker、SQLite outbox 和同版本恢复逐段适配。
2. **再做后端维护**：审阅 xinhai 的 recovery 回收和分批存档、kanomahoro 的已编码帧透传。当前人少无需先扩容；用我们现有负载和指标验证收益，分别决定保存周期与回收窗口。
3. **独立选择新功能**：CI 分片、图片时装、效果倒计时、重刷权限变化可以拆成小更新；外部 AI、六人制、训练采集、另一套集群／mod 层暂不作为默认同步项。

发布继续采用等在线对局结束的冷更新；不新增跨版本存档兼容层。账户和长期历史、未落盘结果继续保留。素材生成与预载包按实际资源变化单独处理，不覆盖本地 `data/assets.json`，也不恢复已明确移除的独立导入器、原生控件或重复设置入口。
