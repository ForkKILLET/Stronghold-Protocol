# MAP10 盐坨子炮：实现与依据（2026-11-19）

## 上游反馈与进度

核对 `sganggs/Stronghold-Protocol` 的 dev `c2b4ca01089dd753d3caeca5b6693ba8074e2505`、
开放／关闭 issue 与 PR 的标题、正文及评论搜索（盐坨、cnnon、MAP10、炮），以及三期开发讨论 #920。
未找到独立的炮台玩法 PR 或已公布的开发安排。搜索索引会漏掉评论，因此也直接核对了地图 #977：

- [作者说明 arena 包含炮台装置数据](https://github.com/sganggs/Stronghold-Protocol/pull/977#issuecomment-6988271723)。这说明场景／摆放来源，不能当作玩法已实现。
- [此前本分支的模型排查记录](https://github.com/sganggs/Stronghold-Protocol/pull/977#issuecomment-6989549493)。
- [三期开发讨论 #920](https://github.com/sganggs/Stronghold-Protocol/discussions/920)。

本地起点的 `trap_196_cnnon` 为 `role:null`，只有场景中的静态网格；模拟未创建单位，也没有炮击、载客或卸客逻辑。

## 证据

- [PRTS 盐坨子炮](https://prts.wiki/w/盐坨子炮)：敌方默认实体、六级数值、技力、固定落点、载客、销毁及免疫规则。
- [PRTS 规程战场一览 #10](https://prts.wiki/w/卫戍协议·规程/战场一览#%2310)：地图对应关系。
- [PRTS 寻险水手](https://prts.wiki/w/寻险水手)：出炮后 1 秒内移动速度提升至 200%。
- 本机官方表固定 `6f63c14e27b847ef74b53b00fe51fc322b3cd7ff`，MAP10 的三个 sub level、character_table／skill_table／enemy_database。
- 已安装客户端热更新 `26-11-06-12-42-25-70182449`，`pkgrps/btl_pfb_tokens_2.ab` 的 `trap_196_cnnon`、
  `battle/prefabs/[uc]projectiles.ab` 的 `projectile_trap_cnnon_small`、`config/buff_template_holder.ab`。

| 参数／行为 | 来源与结果 |
| --- | --- |
| MAP10 炮台 | 实际全为 1 级、DOWN；基础生命 30000／攻击 1200，主关卡 rune 修正后生命 60000／攻击 900；防御 3000，法抗 0 |
| SP | 0 初始、基础 6 消耗，经主关卡 ×3 为 18，每秒 1；阻回停充 |
| 落点 | 等级 1／4 前方 4 格、2／5 为 5 格、3／6 为 6 格 |
| 装载 | Eat：半径 1.1、上限 1、地面、重量 ≤3、同阵营且可选 |
| 炮击 | 弹速 5，半径 1.5，100% 攻击物理溅射；对飞行、忽略迷彩；仍遵守隐匿／不可选及起飞的对地规避 |
| 卸载 | `_randomOffsetBound=0.2`，落点中心边长 0.4 方形；重置为对应原版 extraRoute；0.1 秒免再次装载 |
| 乘客 | 保留原单位身份、血量、增益、倍率、归属和悬赏；不再次生成敌人 |
| 弹道被清除 | 对该弹标记的乘客执行强制击杀 |
| 残血 | 首次致命保留 1 HP；已为 1 HP 再受伤：空炮死亡，载客则仅补射一次，等待自身任一弹落地／清除后死亡 |
| 寻险水手 | `sailor_t[move_speed_up]` 的 MOVE_SPEED／FINAL_SCALER，黑板值 2，持续 1 秒 |
| 模型 | 已安装 composite pack 的 MT_trap_196_cnnon 原网格和贴图；prefab 顶点相对地面，绘制时加地块表面高度 |

主 level 的 routes／branches 为空；必须读取 sub 的 `talent@branch_id` 与 extraRoutes。
sub 的共享分支指向的索引超出本地 extraRoutes 数量，因此生成器在 sub 原坐标中按炮击落点匹配 route，
随后与地块一起移动到 canonical 坐标。普通／联防左炮为 `(13,6) → (9,6) → (9,2)`；
Boss 左炮为 `(6,6) → (2,6) → (2,2)`，右炮最终通向 `(2,18)`。

### 主关卡数值修正

用户补充官服规程等级 13 截图，显示炮台 Lv1、生命 60000／60000、攻击 900、防御 3000，
并报告单人险境与终极均为 60000 生命。回查固定版本的
[MAP10 主关卡](https://github.com/Kengxxiao/ArknightsGameData/blob/6f63c14e27b847ef74b53b00fe51fc322b3cd7ff/zh_CN/gamedata/levels/activities/act3autochess/level_act3autochess_m10.json)，
`char_attribute_add` 为 `MAX_HP=30000`、`ATK=-300`，`char_skill_cd_mul` 为 `scale=3`。
这些是关卡固定修正，未按单人／多人或模拟难度分支；`difficultyMask:NORMAL` 是关卡版本标记。
因此应从基础 30000／1200／6 得到 60000／900／18，而非套用波次敌人的倍率。

主关卡同时提供 prefab key 和实例 alias 选择器的同值记录，生成器读取 prefab key 记录一次。
sub 文件的摆放／路线仍沿用，但其中 `MAX_HP=170000`、`ATK=-400`、`scale=2` 的另一套 rune 不替代主关卡。
首轮实现与旧演示录屏使用了遗漏 rune 的基础值；本次修正后，准备详情、实战属性与首次开炮等待同步更新。

数值修正复验：38 项玩法／UI／版本与 32 项文档检查、类型、改动 lint 和生产构建通过；保留两项既有
lint 警告及构建提示。Chrome 单人 13／20 级的真实准备页面、Battle 帧桥接与两尺寸截图通过，首次炮击为
战斗时间 18 秒，零防御目标受到 900 伤害，无页面／HTTP 错误。Firefox 20 级准备与实战数值截图已核验；
其短动画抓帧断言未通过，调整夹具后的重跑又在准备入口坐标定位超时，均保留失败日志，不记作 Firefox
动画验证通过。浏览器使用受控编队与真实 Battle 帧，不代表完整 WS 对局。收据 `.state/cannon-stats-20261119`；
完整模拟／golden 继续暂停，本次仅本地修改。

## 实现

`content/saltCannon.js` 创建敌方 `kind:device` 的默认实体，保留原始隔断行坐标，参与干员索敌，
采用 taunt −1 与控制／重伤免疫。装置不参与波次总量、清场存活判定或超时漏怪计数。
生命周期专门跳过固定装置的敌人移动；测试约束它始终停留于合法的原始棋盘坐标。

炮弹接入既有 `Projectiles`，范围伤害走公开 `battle.dealDamage`。
载客用原有消失状态与原单位；卸载重置路线进度、攻击停驻和再次载客时间。
静态准备模型与战斗模型交接，战斗销毁可释放网格，切回准备恢复静态炮台。
点击说明读取原版技能文本与属性，2D／缺素材用现有图形回退。

仍需录屏校准的部分：

- `[ASSUMED]` 多个合格单位同时进入时按稳定生成顺序选取；原版选择次序尚未公开。
- 炮弹采用现有固定点弹道的棋盘直线距离／5 计时；原版还有炮口偏移和抛物线高度，精确落地帧需录屏校准。
- 原版发射动画的挂点注册、起手／飞弹衔接和精确落地帧需官服录屏校准；本次只调整表现。

## 本机验证

原始提取与试验在 `.state/cannon-20261119/`。定向检查覆盖实际 MAP10 四种战场、炮击／载客／续路、
飞行与迷彩、重量与不可选、残血／清除、寻险水手、嵯峨重伤免疫、装置说明及 native 网格生命周期。
浏览器记录使用真实 Battle 产生的帧与生产 Pixi／Three 渲染器，编队与单名敌人为受控场景，
不代表完整 WS／Worker 对局。完整本机模拟与 golden 沿用暂停安排。


最终定向检查 **236 通过、0 失败、0 跳过**；类型检查、改动文件 lint、导入检查与生产构建通过。
lint 保留 10 项既有警告，导入检查保留 sim/nodeData 的三项既有 sim-node 提示。
Firefox／Chrome 各完成普通、联防、Boss 三布局、1440×900 与 960×540、炮击／落地／销毁及 2D／3D 切换截图，
页面错误与 HTTP 失败均为 0。Chrome 验证三个炮台格的实际坐标点击；Firefox 补做真实场景包移除／迟到恢复，
备用模型可升级回 native 模型。截图在 `.state/cannon-20261119/screenshots/`。
回放夹具最初跳过首帧、重复使用 fieldId，导致乘客显示残留和点击命中乘客；改为独立 fieldId、连续喂帧和首帧预热后复验。
新增攻击回归的首轮断言错误地期待第一 tick 尚未攻击，修正为实际已造成 2000 伤害；原失败日志保留。


## 原版动画接入（2026-11-19）

### 官服录像补证与落点标记

用户补充 `01 盐坨子炮.mp4`，本机原件为
`/home/forkkillet/.paseo/uploads/upload_7afeb41b-a62b-4bda-927d-d304f2626543/01 盐坨子炮.mp4`。
视频为 2560×1440、30 fps、约 2.965 秒，显示单人规程等级 5、第一回合的普通战场。
约 1.10 秒出现炮口橙球，约 1.50 秒落地爆炸；30 fps 的视觉取点精度约为一帧。
片段未明确显示倍速，以上均为录像时间，不能直接反推游戏秒或两次炮击周期。
录像没有属性面板，60000／900／18 的依据仍是此前截图与主关卡 rune。

录像明确显示金色圆形标记常驻于固定落点，飞行时不跟随弹体，爆炸后仍存在。
回查原版 `cnnon_a[effect_manager]`：通过 `SelectNormalTarget` 创建
`projectile_cnnon_target_mark`，其到达特效为独立的 `trap_cnnon_lockon`。
此前提取的炮台 idle 与这份标记不同；补提取 lockon 后仅新增一份 prefab 描述，七张贴图与网格均复用，
现有索引记录保持相同。运行时按地图装置的距离、朝向与落点表面高度摆放，独立管理标记的循环、清理与恢复。
炮台 idle／出生仍使用原来的本体挂点，发射挂点注册和曲线继续保留原实现，后续可据同视角逐帧进一步校准。

原件帧图、原版 effect manager、索引安装对比及浏览器收据位于 `.state/cannon-official-video-20261119`；
`intermediate-moved-idle` 是查清独立标记前的中间定位实验，最终以 `chrome`／`firefox` 收据为准。

56 项定向／文档检查、类型、改动 lint（1 项既有警告）、资源指纹刷新与生产构建通过；Chrome 三布局、
Firefox 普通布局的实际渲染器截图确认标记可见且锚定落点，关闭后清理、重新开启可创建，页面／HTTP 错误均为零。
截图使用真实 Battle 帧与受控场景，完整模拟／golden 继续暂停。`*-before-clock` 是尚未推进粒子时钟的初图，
最终桌面截图已推进至约 1.334 秒；短屏图为暂停中关闭／重新启用后的布局状态，不作为粒子推进证明。
初次探针误读 handle.anchor（正确为 handle.effect.anchor）的失败日志保留。

### 原版动画提取与显示适配

检查热更新后的 `trap_196_cnnon/Graphic`：`_animation=null`、`_animations=[]`，炮架只有 MeshFilter／MeshRenderer，
没有骨骼或炮架变形轨道。发射能力的 `_effectsWhenStart` 指向独立的 `trap_cnnon_attack_start`，
其中 Animator 使用长 0.233333 秒、11 条曲线的非 legacy AnimationClip；移动光球并改变两层 Sphere 的材质颜色与透明度。
`FixedMuzzle` 引用同一段 clip，`_snapshotTime=0`；Graphic 的 `_specialPoint0` 实际绑定炮架网格，而非按名字查找的普通挂点。
提取器因此为该装置沿显式字段保存 SpecialPoint0／Muzzle／HitPoint／HeadPoint 的别名。

从 `battle/prefabs/effects/trap.ab` 提取十个 `trap_cnnon_*` 描述：idle、start、attack_start、buff、
trail_1／2、explode_1／2、explode_hit、destroyed；使用原有曲线、粒子、网格与贴图格式。
大小炮弹的四条原版 projectile 记录随装置索引合并，普通选键提取保留原有单位／技能及已安装素材。
本机实际地图为 1 级炮，运行时使用 small 的原版弹道参数与 trail_1／explode_1。

`render/vfx/cannonfx.js` 沿已有 OfficialFx 绘制待机、生成、发射、飞弹、落地及销毁，准备期读取实际可见地图的装置，
战斗读取单位视图与既有盐炮事件。炮击轨迹复用 ParacurveMovement 的抛物线形状和模拟给出的飞行时长，
爆炸只由实际落地事件触发；炮台消失后已发出的弹道继续，符合 `_clearProjectileWhenDead=0`。
关闭特效、2D、离开阶段与销毁同步释放；暂停使用原战斗时钟；旧素材安装继续使用程序弹道回退。
同时将预加载收到的 Map iterator 固化一次，避免后续特效收集因遍历耗尽而漏掉装置。

**表现校准与原始数据分开：** 发射 prefab 的 ball 与粒子保存了约 `(5,0,-7)` 的编辑坐标，
直接照搬 Special0 网格的 FBX 轴会使光球出现在炮台旁数格。当前将原动画的首姿注册至 FixedMuzzle，
把其原始 +Z 运动转向实际落点，原始 JSON 和曲线不重写；动画的位移差及渐变照常播放。
这是一项显示注册，尚未通过客户端原生执行逻辑或官服逐帧录屏证明完全一致，不能据截图宣称精确还原。
本轮没有更改模拟伤害、载客或时序。

动画轮原始提取、失败与复验在 `.state/cannon-animation-20261119/`；浏览器使用真实 Battle 帧与生产渲染器，
将插值预测窗口设为零以在指定帧暂停，分别检查动画推进与静止，并非完整 WS／Worker 对局。


### 动画轮验证结果

- 新增八项动画／生命周期回归及一项显式挂点提取回归均通过。完整定向集合 **204 通过、2 失败、0 跳过**。
  两条失败来自已安装旧索引：`enemy_9027_acfnca` 的 HitPoint 超出旧通用范围断言，以及 `char_4016_kazema` 缺少旧 `talentKeys.trait`。
  `.state/scene-pack-fix-20261112/payload/resource-overlay/` 的原索引复现同两条失败；逐项比较确认原有 units／skins／skills／projectiles／prefabs
  无记录改变，仅新增炮台单位、皮肤、四条弹道和十个 prefab。失败／对照收据均保留，不记作全套通过。
- 类型、改动文件 lint（0 错误、12 项既有警告）、导入检查和生产构建完成；保留原三项 sim-node 导入提示及体积警告。
- Firefox／Chrome 各完成普通、联防、Boss，1440×900 与 960×540 截图；实测原 clip 光球向落点／上方移动，
  暂停不推进，full／lite／off 与 2D／3D 切换恢复正常，落地／销毁与阶段清理无新增页面或 HTTP 错误。
  浏览器证据以 `screenshots/main-firefox/` 和 `screenshots/main/` 的最终批次为准。
  最初探针错误地读取 `effect.key`（实际为 `effect.def.key`），中间截图还暴露了编辑坐标偏移；两者已修正重拍。
- 全部提取／检查／构建／浏览器串行运行在限内存 scope，记录无 OOM；完整本机模拟与 golden 仍暂停。
