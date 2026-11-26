# 规程 noStack 修复复验（2026-11-26）

PR #1003 变基至 dev `3f75ad535`，按主线评审限定规程；盟约四个版本保留 PRTS 的隐藏计数规则。

截图以规程真实 Match 的私有盟约视图驱动主线 BondStrip、FlyBonds 和 BondPopup 组件。注入独行旧余额 33，激活精准并触发星源后，独行余额为 0、精准为 2、已激活盟约总层数为 2；随后独行人数归零，图标收起。

Chrome／Firefox 各完成 1440×900、844×390 两种尺寸的触发与归零截图，以及盟约详情打开／关闭。页面、控制台及 HTTP 错误均为零。场景数据为受控 Match，浏览器复验不使用生产对局。

`work-<browser>-triggered-<width>.png` 为触发后；`work-<browser>-withdrawn-<width>.png` 为人数归零后。完整结果见 `browser-work.json`。

官服两段剪辑仍见 [2026-11-25 录像及关键帧](../no-hidden-bond-layers-20261125/README.md)。
