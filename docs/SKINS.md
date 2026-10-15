# 按需干员皮肤

## 来源与范围

采用 `kanomahoro1224/Stronghold-Protocol` 的 `merge/upstream-20261013` 分支（调查时为
`6db504abf77edf06e6db45f0e1c65b20d888ba9a`）中的皮肤实现 `bbb8020533b8c529a99959449fc36491ab573463`。
逐段适配研究表、资源管线、选择器、协议、模拟元数据及渲染；不合入无关功能、游戏配置或另一部署的生成素材清单。

研究表涵盖 174 个干员的 273 套官方时装，不表示当前服务器已部署全部皮肤。数据源沿用官方 `skin_table.json`、
fexli/ArknightsResource 模型和 yuanyan3060/ArknightsGameResource 头像。
遵守项目的非商业、非官方声明和素材权利约定；只换头像、立绘及 Front/Back 模型，不改变特效、数值或技能。

## 玩家开关

- **启用皮肤**（`skinsEnabled`）默认 false、浏览器持久化。开启后在「干员调配」选皮肤，也能看到其他玩家的选择；
  关闭时自己及他人全部默认外观，保留本机选择和缓存。关闭向服务器发送空选择，开启/重连按当前设置重新同步。
- 每个干员详情只保留一个皮肤区域。启用后，加载中、加载失败及暂无可用皮肤均保留标题和关闭开关；
  数据失败可重试。目录中有皮肤但服务器未部署模型时会明确说明，并保持默认外观，不自动安装或下载整套模型。
  暂不可用的已选皮肤仍保留在本机，默认按钮可由玩家主动清除该干员的选择。
- 观看者按自己的显示开关决定外观，不能用本机选择覆盖队友。准备期、精锐、查看队友、联防、首领半场、观战及
  简化 DOM 战场均走所属玩家的元数据。AI、补位、自选槽位保留默认。
- 切换显示开关更新已在画面上的模型，不重建模拟单位、不重置 HP/SP 或战斗时间。局内修改选择更新准备期视图及
  下一场战斗输入；已开始的战斗沿用开始时的外观元数据。
- 只提供当前部署具有有效 Front 模型的皮肤；没有 Back 时用自身 Front，不混用默认服装 Back。
  未知/无效元数据回退默认，皮肤模型请求失败可加载默认模型。
- 选择以基础 **chessId** 为键，精锐沿用；目录和素材以 **charId** 为键，不改变干员库存或游戏逻辑。

资源管理的 **预载皮肤**（`preloadSkins`）默认 false，与显示开关及「同时预载」（`preloadOptional`）独立：

| 皮肤显示 | 皮肤预载（同时开启预载资源） | 行为 |
|---|---|---|
| 关闭 | 关闭 | 默认外观，不批量下载皮肤 |
| 开启 | 关闭 | 实际显示的头像/模型按需请求，运行时 SW 可以缓存 |
| 任意 | 开启 | 批量下载当前部署皮肤，单独分类并计入所选范围完成度 |

皮肤不是必备资源。不开启选择器不请求 `skins.json`，缩略图懒加载，模型不进入首屏静态依赖。
切换预载范围中止旧任务、按最新范围增量补缺，不删除已有缓存；战斗闸门继续暂停批量下载，
手动暂停、关闭预载或清理不被自动恢复覆盖。
ZIP 仍校验并保存包内未选择的有效皮肤，导出包含全部有效缓存；只在导入后的网络补缺按范围过滤。

## 名片皮肤头像

头像选择分两步：先搜索或按稀有度选择干员，再选择该干员的默认头像或皮肤头像。第二步可返回干员列表，
保留搜索和稀有度；取消或关闭不更改原选择。皮肤目录仅在第二步读取，失败可重试，默认头像始终可选。
只列出目录中且 `assets.chars[charId].skins[skinId].avatar` 已有头像的皮肤，不要求部署战场模型，
不切换 `skinsEnabled` / `preloadSkins`，也不下载模型。缺少所选皮肤时保留偏好并显示该干员默认头像。

沿用 `sp.pref.room.card` 和 `room.card` 的 `{ charId, avatar }`：`avatar` 可为旧的干员 ID 或完整皮肤 ID
（如 `char_498_inside@kitchen#2`）。`charId` 决定房间立绘，也支持完整皮肤 ID。服务端校验格式及各自所属干员，
URL 仅从该干员的素材清单解析；未知皮肤不构成任意 URL。大厅、房间、成就和结算页使用同一选择。
结算同盟卡的立绘优先使用该玩家选择的房间立绘；未选、素材缺失或旧数据沿用阵容最高阶干员作为回退，
不使用头像或其他玩家的本机选择替代立绘。
复用原同步、断线重发及 Session/座位持久化，旧偏好无需迁移，不进入 Match Worker 游戏状态。

## 皮肤立绘

现有立绘位置统一支持皮肤：干员调配详情和卡片、商店、干员详情（含查看队友和战斗单位）、自选卡片的默认回退、
个人结算阵容和同盟结算卡。游戏内立绘沿用所属玩家的基础 chessId 皮肤选择及观看者的 `skinsEnabled`，
精锐沿用同一选择；战斗单位优先使用该场战斗携带的皮肤。AI、补位及自选槽位继续默认，不借用观看者的皮肤。
关闭显示立即恢复默认，保留已选皮肤；立绘缺失或请求失败按普通/精锐回退原立绘。

房间“更换立绘”先选干员，再选默认或已部署的皮肤立绘；返回保留搜索和稀有度，取消不保存。
目录仅第二步按需加载，保留加载、重试、空状态及已选素材缺失提示。
沿用 `{ charId, avatar }`，`charId` 可为旧干员 ID 或完整皮肤 ID，与头像独立，按所属干员的素材清单解析。
名片立绘与名片头像一样独立于战场显示/预载开关，不要求模型；同房玩家、观战者及结算读取该玩家自己的选择。
未知皮肤保留偏好并回退该干员原立绘，陌生干员、外部 URL 或非法路径仍拒绝。

素材来自 yuanyan3060/ArknightsGameResource 的 `portrait/{portraitId}.png`（180×360），
`portraitId` 已按官方 `skin_table.json` 对照写入研究表。无需下载数 MiB 的全尺寸 `skin/` 原画。
清单字段为 `chars[charId].skins[skinId].portrait`；立绘属于可选皮肤预载、缓存与 ZIP 范围，沿用素材 CDN。

## 部署皮肤素材

没有浏览器安装接口或 `room.skin.install`，游戏服务器不代玩家访问第三方下载站。
管理员在部署机运行以下命令，不对开发机现有共享素材目录自动执行安装：

```sh
node tools/build-skins.mjs
node tools/install-skins.mjs list
node tools/install-skins.mjs add 'char_498_inside@kitchen#2'
node tools/install-skins.mjs add-char char_498_inside
node tools/install-skins.mjs add-all
# 只为当前已安装的皮肤补齐立绘，不重装模型或改动安装选择：
node tools/install-skins.mjs portraits
node tools/asset-hashes.mjs
```

`add-all` 可选，下载量以实际成功文件为准。通过原 `processModels()` / 动画角色解析，以成功 Front 模型更新
`data/assets.json`。`data/skins-installed.json` 是本部署选择记录，忽略且不随源码提交，不复制另一部署记录。
再次 `npm run assets` 只保留该记录中的皮肤；`remove <skinId…>` 移出清单，磁盘文件暂留。
安装可中断重试；清单和记录各自原子写入，中断在两次写入之间时重新安装修复。不要并行运行安装/素材重建工具。

同步新的 `data/assets.json`、`data/skins.json`、`data/asset-hashes.json` 到服务器及数据 CDN；
同步 `public/assets/spine/op/<charId>/<skinStem>/`、`public/assets/char/avatar/skin/` 和 `public/assets/char/portrait/skin/` 到素材 CDN。
保留 CDN 前缀、CORS 头并按既有策略刷新缓存，目录表不能替代素材部署。数据更新后，若部署提供
`scripts/copy-data-to-nginx.sh`，核对实际 Nginx alias；当前 `srv` 配置在仓库根目录执行：

```sh
sudo bash scripts/copy-data-to-nginx.sh ./data /opt/1panel/www/sites/wei.linxia.dev/index/srv
```

重新构建并重建镜像/容器，保留挂载、Redis 和公告排期；旧数据/素材挂载可能覆盖镜像内容。
更新 SW（`resources/common.js` 变化）和 UI 语言 JSON。不承诺未经实测的线上进行中对局跨版本无缝恢复。
本机直接运行 Node 时同样需要重启原服务进程：只重新构建、刷新页面会更新前端文件，但旧进程仍可能按旧规则拒绝
皮肤立绘的 `room.card.charId`，返回 `BAD_MSG / bad field charId`，此时房间继续展示上次已确认的立绘。

## 协议和恢复

`room.skins { skins: { [baseChessId]: skinId } }` 有数量/长度/格式约束及重消息限流；
服务端过滤隐藏、精锐、自选、非基础棋子，身份取当前会话。观战者只保存未来偏好，不修改被观战者。
未知但格式合法的 skinId 不构成 URL；渲染只查部署清单，查不到用默认。
偏好进入 Session、座位、等待队列、外部匹配队友、Match Worker、检查点和连续恢复；旧检查点为空，
退出/存活/空原房间容器规则不变。
`m.public.players[].skins` 仅非空时出现，战斗输入 → Unit → `unitInfo.skin` 传递所属玩家选择；
普通快照元组和战斗结果不变。

## 验证范围

新增 `test/skins*.test.js`、`test/skin-tools.test.js`、`test/ui/skins.test.js`、`test/render/skins.test.js`，
并补资源范围、ZIP、战斗闸门、Vite 模拟比对及恢复回归。Node/Fake Pixi 不等于真机浏览器或 CDN 验收。
发布前手动验证：多玩家不同皮肤、另一观看者关闭显示、精锐和向上朝向、简化战场、断线重连、SW 更新、
仅音频/仅皮肤预载、战斗中切换范围和 ZIP 导入后的补缺。

### 2026-10-14 本次验证

- 修改前相关资源/大厅/匹配/持久化/Worker 基线：408 通过、0 失败。
- Node 22.23.3，`node --test --test-concurrency=4`：7041 项，7020 通过、0 失败、21 跳过；
  跳过的浏览器等测试不作为实测证据。最终全量耗时约 402 秒。
- `npm run golden`：全部 287 场景匹配，无黄金基线变更。
- `npm run build`、Vite 打包/Node 模拟比对（包括所属玩家皮肤及不改变战斗结果）、`npm run typecheck`、
  发行包白名单、`git diff --check` 均通过。构建保留原有大分包警告。
- 真实 Redis 可达；原恢复测试通过，补充完整 Match Worker 经过三次 Redis 重启后皮肤 Session/检查点仍一致；
  新增外部匹配队友的本地/Worker 双重连续恢复、观战权限及旧检查点默认值回归通过。
- lint：0 错误、154 警告；导入检查仍列出与修改前完全相同的 3 条 Node-only `nodeData.js` 提示。
  新界面文本补齐四个语言包；英语 1379/1379，另三包保留既有 197 条缺译回退，无格式错误。
- 首次全量暴露文档头部约定、协议监控白名单、设置/模型签名断言和发行白名单预期，均已适配；
  ZIP 配额测试原先假定并发文件顺序，改为先等待首个成功写入再制造配额失败，不改变生产导入逻辑。
- 未下载整套皮肤，开发工作树当前安装数为 0；未改动原工作区公告、素材清单或其他正在进行的修改。
  浏览器、真机、Docker 和真实 CDN 素材下载尚未实测。
