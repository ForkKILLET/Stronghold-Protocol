# 主线 dev 与新 PR 合入计划（2026-11-24）

更新：第一批已在本地完成，实际合并及验证见 [合入报告](MERGE_DEV_2026-11-24.md)。下文保留合入前审查依据。

本服当前 `22a67c698`，最近已合入的主线为 `18e7600ee`。本次固定 dev
[`c7cea5a9b`](https://github.com/sganggs/Stronghold-Protocol/commit/c7cea5a9b1723736ca9563ac42e0770253ebeb6e)，
刷新结束时仍为该 SHA。新增 46 个提交，82 个文件（3,124 增行／417 删行）。
已读 PR 正文、维护者回复、最新作者回复、文件差异与 CI；实际运行仅 Git 合并预演和只读源代码核对。

## 建议顺序

| 批次 | 对象 | 判断 |
| --- | --- | --- |
| 第一批 | dev `c7cea5a9b` | 建议合入，包含 #922／#997／#999 及维护者合入时的修正。 |
| 第一批 | [#1001](https://github.com/sganggs/Stronghold-Protocol/pull/1001) `3d675ceba` | 接在 dev 后，修复乐部第四攻二连击；依赖 dev 已合入的禁疗适配。 |
| 第一批 | [#1000](https://github.com/sganggs/Stronghold-Protocol/pull/1000) `07040ee8d` | 建议合入，补召唤物时装提取；保留本服 200 MiB 插件分卷预算。 |
| 第二批 | [#973](https://github.com/sganggs/Stronghold-Protocol/pull/973) `bebbb2c6b` | 已 Ready、可合并，维护者上一轮称无阻塞项，作者已回复后续意见。单独做 WebGL 商店适配、提取与截图验收。 |

上述三个开放 PR 都以当前 dev 为祖先，当前均 MERGEABLE／CLEAN，CI 的 Linux／Windows 分片、tooling、Node 24 守卫、Python 和默认 golden 检查均成功。
dev 本身的 [CI](https://github.com/sganggs/Stronghold-Protocol/actions/runs/45253698517) 与
[Python 检查](https://github.com/sganggs/Stronghold-Protocol/actions/runs/45253698611) 共 12 项成功。
CI 的 golden job 比较默认版本；规程版本的本地结果需分别核对。

## dev 重点

### 队友速查 #922

[#922 最新维护者回复](https://github.com/sganggs/Stronghold-Protocol/pull/922) 确认重基、跨回合／阶段去抖与说明已修好，
并已合入。采用 dev 最终实现，含合入后修正：盟约卡片箭头沿当前座位循环、跳过零人数映射盟约、临时层数黄色、
精锐边框、淘汰本人不画无效导航。

新通道 `g.peek`／`m.peek` 只传在场干员 ID 和精锐位，任何战斗／Boss 跨组都能看名单；不取代 `g.watch` 的战场流。
保留本服默认开启的战中／Boss 查看、账户头像／档案链接、Boss 总血量、小工具及字幕避让。
`main.js` 合并时同时保留本服匹配队列事件和新 peek 缓存生命周期；`protocol.js` 合并保留记牌器／暂停等本服消息。
验证独立 Match Worker 的收发、重连／离场／淘汰／阶段边界和观战权限；peek 不写入持久状态。

### 盟约显示与旧期依据

§37.342 补充了四个旧期 31 段官服录像的链接和时间点，纠正此前旧期沿用规程样式的假设：

- 一、二期顶栏没有阶段数字，激活圆盘按第一档人数显示全亮的分段圈 `N_N`。
- 三期顶栏继续按官方 phaseType／phaseCounts 显示阶段数字，激活外圈仍是 `1_1`；保留我们已确认的层数阶段与满圈。
- 三期详情左上圆盘按第一档人数分段；人数统一为「实际人数／第一档人数」，例如不屈 3 人显示 `3/2`、阶段Ⅱ。
  主线引用 #923 第 11 回合官服截图，区分了详情圆盘与顶栏圆盘。鼠标提示与详情条目跟随同一分母。
- 本服 `useAssetImage` 图片恢复、黄色临时合计／归属、角标位置及原版主题适配继续保留。

这里的取消数字仅针对旧期，与三期的截图规则相容。官方视频出处及样式范围已在主线
[history §37.342](https://github.com/sganggs/Stronghold-Protocol/blob/c7cea5a9b1723736ca9563ac42e0770253ebeb6e/docs/history/0.4.0.md) 列出；本轮没有另行抓帧。

### 玩法与性能

- [#997](https://github.com/sganggs/Stronghold-Protocol/pull/997)：小节／乐部持有禁疗，直接治疗与治疗索敌受限，生命回复仍有效。
  维护者补齐 5 场规程 matches；部分阵容 LP 下降属于这次修正的预期影响。
- §37.343：仅第二期上半的远见，150 层全体减价与 80 层远见减价叠加，远见干员共减 2；本服默认第二期下半沿替换规则。
  `layerMilestones` 补首次到达行，需通过生成器隔离重建核对，保留本服生成契约。
- [#999](https://github.com/sganggs/Stronghold-Protocol/pull/999)：GameData 分离的棋子盟约缓存、冻结阈值、`someChess` 和键解析优化。
  dev 已含维护者补充的装备变形／DIY 隔离测试。预期逐字段结果不变；性能收益不直接采用作者机器上的数字。
- 浏览器回归修正接入符合本服实际 UI 的部分，核对测试前提后调整，不整份覆盖本服 E2E。

## 新 PR 的适配点

**#1001（8 文件）**：官方生成数据明确有 `Sk1.spCost = 3` 和「攻击三次后下次二连击」。
实现按 attackId 记录，处理高攻速下弹道重叠；测试覆盖 `[1,1,1,2]` 周期、单击击杀和小节单发。
两段在同一落地时连续结算、沉默不打断周期是 PR 明示的假设；验证时保留这些标记。

**#1000（9 文件）**：按官方 `tokenSkinMap` 导出主人时装对应的召唤物模型／头像，沿现有召唤物时装运行时格式。
上游工具常量仍是 512 MiB，本服是 200 MiB；分卷计算及说明按本服消费者保留。
核对主人筛选／limit、缺模型 token、token 与干员共用分卷、已有目录重跑和插件 pack／strict 检查。

**#973（125 文件，约 21,651 增行）**：不再是纯客户端画面改动，还新增商店刷新序号、特殊刷新状态与佩佩待用次数标记。
与本服规程主题强制布局、服务端主题下载、字幕、小工具、商店折叠和卡面搜索／详情共同适配。

- 当前本机可露希尔／乌萨斯主题组都只有 `prefabs.json`，没有 `card.json`／`shop.json`；仅合代码不会启用画布商店。
- 本服 `shared/resourcePaths.js` 的主题 JSON 白名单也没有 `card`／`shop`，需精确扩展并验证预载、缓存、ZIP 和部署 overlay。
- 先在隔离输出执行 `--only shopdocs/ac_s_closur`，核对三份文档、附属纹理和主题包，再接入服务器下载。
  官方字体独立核对提取／分发约束，按提取说明处理。
- 维护者已提的特殊刷新标记可能与插件调用消耗佩佩标记不同步，作者沿现有行为记录了假设；验收要覆盖连续两次升级、驻防刷新和插件刷新。
- 默认／可露希尔／乌萨斯，Chrome／Firefox，桌面／短屏／手机及两种主题动画设置分开截图；验证晋升奖励、六格奖励、双击购买、热键、冻结、切主题、上下文丢失恢复。
  上游的 Firefox 性能记录和 premultipliedAlpha 调整不能代替本机同帧／动效核对。

## 合并预演与验收

从本服 HEAD 对固定 dev 预演，15 个冲突：8 个源码、5 个测试、2 个文档。
预演树 `10752eed338d9180bfdc67566437d8bd50d9b809` 含未解决的冲突标记，仅供分析。

重点冲突为 `main.js`、`screens/game.js`、`teamPanel.js`、盟约组件／详情、`bondsMeta.js` 与协议；
五个 E2E／UI 测试按本服入口与账户隔离夹具适配。

第一批合并后先跑盟约缓存／变形／DIY、peek／Worker、远见、莱塔尼亚及提取器定向检查，再做构建／类型／lint／导入。
双浏览器覆盖旧期／三期圆盘、详情导航／临时层、速查与本人／队友／淘汰／跨组场景，并复验字幕与小工具避让。

golden 使用合入前实际 digest 做同种子比较，先核对这 9 个明确受影响的场景：

- 第二期上半 `solo-HARD-9-boosted`；
- 三期 `roster-004`／`roster-028`；
- 三期 matches：`coop3-ABYSS-5`、`coop2-NORMAL-8-serverrun`、`coop2-HARD-4`、`coop2-NORMAL-70-diy`、`coop2-NORMAL-5-coverage-diy`；
- 三期 `bond-lethaniaShip-high`（#1001）。

#999 和 UI 更新不应额外移动结果；上轮遗留失败／125 场基线漂移单独比较，不把接受上游 golden 当成本服通过。
本轮检查没有运行组合测试、浏览器或 golden。

## 继续保留的开放项

- [#927](https://github.com/sganggs/Stronghold-Protocol/pull/927)：仍 Draft／冲突，作者暂停；称号条件、统计赛季切分和伤害百分比舍入问题仍待解决。
- #807／#808／#810：旧架构与结果校验方案，维持原范围。
- #550：目标仍是旧 master，维持原范围。

原始 API、评审正文、精确 head、CI 和预演输出在本机 `.state/merge-dev-20261124`。
