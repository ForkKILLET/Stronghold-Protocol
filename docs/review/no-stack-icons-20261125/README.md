# 零人数无层数盟约图标对照

基线：主线 dev `c7cea5a9b`。修复：`60c02d351`。

使用主线真实 `BondStrip`、`FlyBonds` 和 `BondPopup` 组件，以玩家公开回放 34:49 的盟约列表重现。
回放地址：https://genshin.asm.ms:7999/?doctor=5JT4&replay=d6536263-699b-4d86-b003-662ae47ccdbf

其中协防干员为 `{ bondId: "emptyShip", count: 0, active: false, tier: 0, layers: 33 }`，
独行为零人、未激活、内部计数 20。两者的 `noStack` 为 true。
修复后这两项从盟约栏和速查收起，可叠层盟约的零人数记录仍保留。

截图由回放中的盟约列表驱动隔离组件；`before` 为基线浏览器源码，`after` 为修复源码。
队友速查继承与正式界面相同的 `.52rem` 图标尺寸。
Chrome、Firefox 各完成 1440×900 与 844×390 的前后截图，以及盟约详情打开／关闭。
两浏览器页面、控制台和 HTTP 错误均为零，结构化结果见同目录 JSON。
