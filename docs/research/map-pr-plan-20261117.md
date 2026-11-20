# 地图系列 PR 状态与计划

## 2026-11-20 更新

#978–#981 均已吸收进主线 dev bb1172306，详见 [回复复核与后续清单](pr-next-20261120.md)。主线导出默认单文件，本服重新提取时需设置 `SP_SCENE_PART_BYTES=15000000`；新 helper 清理段数减少后的残余文件与清单键。活性源石／沼泽需重提取 FX，索引版本未变。M4 经验光照仍待维护者回复；盐坨子炮按现有主线玩法审计后拆分后续 PR。

## 2026-11-19：沿 #977 场景基础提交后续修复

用户确认采用 #977 作为场景基础，旧 M2 整套导出／布局替换稿撤下，不另发竞争实现。已复核最新主线 `dev c2b4ca01089dd753d3caeca5b6693ba8074e2505`：#977 虽仍为 OPEN，其实现已由 `cf5b8d742` 集成，新版 arena 也包含装置记录。四份 PR 各自基于该 dev，仅一项提交，不夹带本服 main；本轮没有合并主线或部署。

| PR | 内容 | 当前验证与边界 |
| --- | --- | --- |
| [#978](https://github.com/sganggs/Stronghold-Protocol/pull/978) | Boss／隐秘核心准备页进入敌人预览保留来源 sub_03 | GameScreen 真实预览／返回控件、两尺寸及三种地图状态；主线完整 golden、Linux／Windows 各四片及 tooling 全绿。不是完整 WS 对局。 |
| [#979](https://github.com/sganggs/Stronghold-Protocol/pull/979)（M1） | 两套导出器共用有界 scene 二进制分段，客户端校验后重组 | 56 项定向／文档与类型／lint 通过；MAP05／10／12 原始二进制分别 2／3／3 段，重组 SHA-256 一致。Firefox 九场景；本服生产分包器 9 包最大 15,010,851 字节、14 项完整读回。主线 ZIP entry 上限为 256 MiB，本项为本服 16 MB 分包兼容，不称主线超限。 |
| [#980](https://github.com/sganggs/Stronghold-Protocol/pull/980) | 不透明 albedo 零 alpha 有效 RGB 兼容导出 | 103 项定向／文档与类型／lint 通过；MAP09／11 RGB 精确相同、原共享 RGBA 保留；Firefox 六场景。提取版本 6，仅格式 freshness；不是旧故障的 GPU／解码根因证明，未新增玩家设备复验。 |
| [#981](https://github.com/sganggs/Stronghold-Protocol/pull/981)（M3） | 地图独立 OfficialFx 生命周期，源石／沼泽／隐匿原版特效及格面深度 | 106 项定向／文档与类型／lint 通过；Firefox 九场景及 MAP04 GameScreen 持续 60 秒、clear、off／lite、2D／3D。首帧未建立 meshes 的问题已修正并补回归；最终无新增 frame failed。MapSettings.highlandHeight 元数据来自原版，九块实际 prefab 均 0.4；旧包回退 board 近似，不冒充完整装饰深度。 |

后三份新 PR 的完整主线 CI 尚未显示启动（标签检查完成），不记作通过。完整本机模拟／golden 继续暂停；不复制本服旧 golden。源代码无游戏二进制；[固定证据分支](https://github.com/ForkKILLET/Stronghold-Protocol/tree/3c473e1bff33cdae540523cb9ed82edd6873b225) 仅截图、字段与读回收据。模型截图基于已提取网格和生产 helper 生成的新元数据／分段／RGB 副本，不冒称重跑完整 Unity 导出。Firefox GameScreen 保留基线 data-URL CSP 诊断及 bond_level_3.png 404；render-demo 无 HTTP 失败。

M4（沙地顶点混色 0.625 与每图 RGB 增益）已在 [#977 评论](https://github.com/sganggs/Stronghold-Protocol/pull/977#issuecomment-6989549493) 中先讨论接受范围，未发拟合代码 PR；这些参数为经验拟合，不能称作官服运行时值。MAP10 炮已存在 arena 装置记录，但固定展示场景仍未见其图形，留作装置视图／模型加载的后续调查，不能再归因为缺少 arena 数据。

本轮隔离 worktree、原始失败／诊断和所有图片保留于 `.state/map-followups-20261119`，此前十图对比索引保留于 `.state/pr977-review-20261119/screenshots/index.html`。初始调试接口读取、Pillow 环境、freshness 断言、pack 夹具 version 字段及 Firefox 旧 LD_LIBRARY_PATH 错误均留收据；对应最终定向与浏览器复验见各 PR，不以中间失败冒称通过。

## 2026-11-17 原始计划（历史归档，以下 M2 与依赖顺序已被上节替代）

基线为主线 `dev 55f528e9f`，来源为本服 `fd28fa090`／`f19ead595` 及其后续修正。本轮只制定计划，不创建地图 PR 或上传地图二进制。

主线已有十图的三块 sub prefab 组合、背景／水面处理及 `syncGrassFx`；不能再使用旧稿“主线尚无三期导出器”的问题描述，也不能直接覆盖整份导出器。本服的普通／联防／Boss 场景、独立光照页、严格区域裁剪、右侧预览及地形 FX 是待审查的实际差异。

## 拆分与顺序

| 次序 | 拟定 PR | 范围及依赖 | 验收边界 |
| --- | --- | --- | --- |
| M1 | 大场景二进制分段传输 | 独立的 scene 格式扩展：可变段数、每段最多 15,000,000 字节；有序 bin／binN 键，独立总量／段数预算，声明校验后单次分配并逐段写入。旧单文件不变。先交通用加载／导出契约，不扩 ZIP 单文件 16 MB 上限。 | MAP10／12 重组 SHA-256 等于原网格；旧包、缺段、错大小、重复键及异常路径回退；资源清单、JSON 白名单、预载、ZIP／打包工具同步，不提交资源文件。 |
| M2 | 原版场景导出及阶段展示布局 | 依赖 M1。普通完整 sub_01、联防完整 sub_02 及其自带单排整备台、Boss 完整 sub_03；按区域所有权精确裁剪并插值顶点属性，保留独立光照页与材质绑定、背景／水面，修正角色脚点。普通波次预览移至右侧，移除联防上方旧预览残影；补 MAP10 炮和真实箱体图形。 | 规范 19×21 模拟坐标、部署、寻路、波次与回放不变；仅 renderLayouts 控制展示。十图×普通／联防／Boss 共 30 场景在主线分支重拍；预览选敌、镜头切换、2D／缺资源回退均验证。炮只导入图形，不猜技能。 |
| M3 | 持续地形 FX 与真实地块遮挡 | 依赖 M2 及本轮 MapEffect 生命周期 PR。将主线 syncGrassFx 整合进单一地图拥有的生命周期，加入源石／沼泽等实际存在的持续特效；通过可见格面高度给独立 OfficialFx 通道提供深度。 | 图 9 最下方隐匿红光被前方整备台自然遮挡；不裁红框、不全局改战斗 FX 层级。不重复隐匿特效；普通／联防／Boss 切换、特效开关、异步加载、缺素材回退与释放均核验。加速／传送无原版持续 effect 时保留标识，不造粒子。 |
| M4（讨论后） | 沙地花纹及十图粗光照 | 依赖 M2；与 M3 可独立评审。原版顶点混色分支和截图拟合参数明确分开，经验增益仅用于 Regulation composite 场景，不影响旧赛季、Unlit、水面、单位或 FX。 | 用同版本／同相机对照，普通与联防训练、Boss 留出验证；记录误差与差异。0.625 和每图 RGB 增益不是官服运行时参数，先问维护者是否接受近似。后续用户录屏优先验证，不写逐格蒙版。 |

雪地 opaque RGB 兼容导出可以作为额外的独立小 PR，与 M1／M2 同步审查即可；它修复了已反馈设备上的现象，但不以此声称定位了 GPU／解码根因。不要把尚未复现的诊断工具和设备归因塞入地图导入。

## 可复用资料与必须重做的部分

- 原版 PC prefab、Transform、MapGraphic、材质、地块 effect、光照绑定的提取收据继续有效；来源与边界分别见 [场景导入](regulation-scene-import-20261112.md)、[细节核对](regulation-scene-details-20261112.md)、[同视角对比](regulation-prts-view-20261112.md)、[地形深度](terrain-fx-depth-20261112.md)、[光照拟合](map-light-calibration-20261112.md)。
- 原先 `.state/pr-next-20261112/05–07` 是旧基线本地稿，不是准备好推送的分支。先从当前主线逐项对照几何裁剪、背景、水面和光照页，保留其后续修正，再适配本服差异。
- 本服已有 30 张截图同时包含后续光照拟合。M2 必须重拍不含 M4 参数的版本；M3 必须与 M2 相同相机／光照，避免把亮度差当成层级修复。
- 准备实际提取／安装／HTTP／缓存／分包往返的检查；游戏源码 PR 不含模型、贴图或游戏包。另以固定截图 SHA 提供视觉证据，不能只贴本机路径。
- 按独立 worktree 逐份适配，新增 scene 格式写入 `docs/ASSETS.md`，展示布局写入 `docs/design/client.md`，同步当前历史与更新日志。保持旧格式可读，失败有可识别回退。
- 本机定向与浏览器检查串行走内存保护；完整模拟／golden 的本机暂停不因该计划解除。最终 CI／golden 由主线对应 PR 的 Actions 评估，不复制本服旧基线。

建议先评审 M1 的小范围格式扩展，再投入 M2 的主线资源重提取与 30 图截图；M3 随后。M4 保留讨论稿，等待新录屏。
