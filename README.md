# 三期整备区溢出准备依据

用户于 2026-11-27 提供的官服三期多人终极模拟截图。

- `official-overflow-ready.png`：存在无法放置单位的红色警告，右上准备按钮可用。
- `official-overflow-confirm.png`：准备确认明确临时干员和装备进入战斗后销毁，召唤物下个休整期返还。

复核图由源码客户端与受控 HUD 状态生成；配置、盟约、干员、装备读取对应版本数据。
库存、服务端准备准入、召唤物返还及旧版本边界由真实 Match/PlayerState 数据回归验证。

独立修复提交：`aba769b3620dbabaca9894e155e330e3a3e36222`，基于 `dev 3f75ad535`。

Chrome / Firefox 各桌面 1600×900、短屏 640×360；按钮、快捷键、取消／确认／撤回、合并提醒、阶段结束收起和旧期限制通过。
`regulation-overflow-available.png` 与 `regulation-overflow-confirm.png` 为 Chrome，
`regulation-overflow-confirm-mobile.png` 为 Firefox 短屏，`regulation-overflow-with-funds.png` 为资金／溢出合并提示。

Node v26.13.1 定向／文档／CI 守卫 126 项通过；三期整局 golden 14 场全部重算，结果逐字节等于原基线，
engine / logged / sim / dispatcher 错误均为零。类型、四语言新文案检查通过；改动 lint 零错误。
浏览器采用真实源码组件与受控 HUD，服务端玩法和库存另由 Match 回归覆盖。
