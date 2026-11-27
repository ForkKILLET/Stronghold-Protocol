# 三期整备区溢出时允许准备

本服与公共 PR 均按三期规程处理。独立分支 `fix/regulation-overflow-ready` 基于主线 `dev 3f75ad535`，工作目录为 `.state/overflow-ready-20261127/work`。

## 官方依据

用户 2026-11-27 提供的三期多人终极模拟截图：

- 场上提示存在无法放置的单位，右上「准备就绪」仍可点击。
- 点击后出现确认：「当前仍处于临时整备区的干员和装备，将在进入战斗后自动销毁（召唤物仍会在下个休整期出现）」。

原图与复核截图整理于 `.state/overflow-ready-20261127/evidence`。

## 修复

`PlayerState.setReady` 原本无条件拒绝非空临时整备区，私有视图的 `canReady` 和准备按钮也阻止操作。
新增 `tempBlocksReady`，按 `config.version.family` 判断；按钮与快捷键共用溢出确认。确认框将溢出、剩余资金和未用指令的提醒合并，清理警告使用危险色按钮，指令提醒的静音开关只影响指令。

点击确认只标记准备状态。到期溢出仍由 `endPrep` 清理，返还对应卡池与装备库存，永久装备栏保留；在场召唤者的溢出召唤物下个休整期补回。同步修正审计器对 Ready 的旧断言。

## 验证

验证收据：`.state/overflow-ready-20261127`；Node v26.13.1，所有重任务限额串行，零 OOM。

- 本服：103 项定向／文档检查及 14 项实际 Vite 构建／打包验证通过；类型和文案检查通过，改动 lint 零错误／11 条既有警告或忽略提示。
- 独立 PR：126 项定向／文档／CI 守卫通过；类型及四语言文案检查通过，改动 lint 零错误／3 条既有警告或忽略提示。
- 本服和独立 PR 的 Chrome／Firefox 各 4 项交互通过，共 20 张最终截图；桌面／640px、按钮／快捷键、取消／确认／撤回、资金／指令合并提示、静音边界、阶段结束收起、永久装备及旧期限制均有验证。页面／控制台／HTTP 零错误。
- 独立 PR 的三期整局 golden 全部 14 场重算，425.8 秒，结果与原基线逐字节一致；engine／logged／sim／dispatcher 错误均为零。此次验证范围为整局家族，本服组合 golden 和完整仓库测试未重跑。
- 导入扫描保留 `server/sim/nodeData.js` 的三条既有 sim-node 诊断；未修改 HEAD 的隔离副本复核得到相同报告。
- 修改前四项规则回归失败、最初召唤物夹具参数错误、快捷键／浮窗选择器夹具失败、截图动画等待修正及一次检查锁占用记录均保留；最终复验通过。

## 本地提交与草稿

独立代码提交：`aba769b3620dbabaca9894e155e330e3a3e36222`；证据提交：`0ac53a965da150766c8aac0398a9f74c2fff3852`。
分支：`fix/regulation-overflow-ready`、`review/regulation-overflow-ready-20261127`。
两分支和本服修复均保存在本机，尚未推送或发布 PR。
以下正文的证据链接将在推送证据分支后可访问；本地图片在 `.state/overflow-ready-20261127/evidence`。

## PR 正文草稿

标题：`fix: 三期整备区溢出时允许确认准备`

三期规程中，整备区溢出时会被服务端与准备按钮共同拦截。官方多人终极模拟截图显示，此时可以点击准备，并先确认临时整备区的干员和装备会在进入战斗时销毁，召唤物下个休整期返还。

按该规则调整三期的准备准入。按钮与快捷键共用确认框，溢出警告与剩余资金、未用指令提示合并；到期溢出在休整期结束时处理。同步更新私有视图、审计和说明，并加入库存返还、永久装备栏、召唤物返还及四个旧版本的边界回归。

官方依据：[溢出时准备按钮可用](https://raw.githubusercontent.com/ForkKILLET/Stronghold-Protocol/0ac53a965da150766c8aac0398a9f74c2fff3852/official-overflow-ready.png)、[点击后的清理确认](https://raw.githubusercontent.com/ForkKILLET/Stronghold-Protocol/0ac53a965da150766c8aac0398a9f74c2fff3852/official-overflow-confirm.png)。

效果：[桌面确认框](https://raw.githubusercontent.com/ForkKILLET/Stronghold-Protocol/0ac53a965da150766c8aac0398a9f74c2fff3852/regulation-overflow-confirm.png)、[Firefox 短屏](https://raw.githubusercontent.com/ForkKILLET/Stronghold-Protocol/0ac53a965da150766c8aac0398a9f74c2fff3852/regulation-overflow-confirm-mobile.png)。

验证：

- 定向玩法／客户端／文档／CI 守卫：126 通过、0 失败。
- Chrome、Firefox：各 4 项交互通过，覆盖 1600×900 和 640×360；页面、控制台、HTTP 零错误。
- 三期整局 golden 全部 14 场重算，结果与原基线逐字节一致，engine／logged／sim／dispatcher 错误均为零。
- 类型、四语言文案检查通过；改动 lint 零错误。
