# 盐坨子炮 PR 审阅证据

代码基线：主线 dev `bb1172306227e5d2511db85df2cc5cf664ace0a3`。
玩法分支 `34ee42209`，表现分支 `63359bae6`。

## 官服依据

`evidence/salt-cannon-official.mp4` 为用户提供《01 盐坨子炮.mp4》的去音轨审阅副本。H.264 视频流直接复制，保留 2560×1440、30 fps；源容器约 2.965 秒，去除音轨后视频约 2.933 秒。普通战场、单人规程等级 5、第一回合，画面可见一次发射／飞行／落地及常驻落点标记。该片段没有展示数值面板、完整周期或多个乘客选择顺序。

玩法数据来自 [PRTS 盐坨子炮](https://prts.wiki/w/盐坨子炮)、[PRTS 寻险水手](https://prts.wiki/w/寻险水手)、固定官方表 6f63c14e 的 MAP10 与子场景，以及用户安装 PC 客户端热更新 26-11-06-12-42-25-70182449 的 prefab／projectile／buff。

## 浏览器验证

Chrome／Firefox 各完成普通、联防、Boss 三战场的桌面 1440×900 和短屏 960×540 验证，共 44 张本机截图。本分支选择 12 张供审阅，完整场景收据在 receipts/chrome.json、firefox.json。

截图使用真实渲染器及本分支真实 Battle 帧、受控编队，表现来自 63359bae6，包含玩法分支。设备位置以真实指针点击检查地块事件；特效档位和 2D／3D 使用页面 API。覆盖装载隐藏／落地重新显示、暂停效果时钟、off／lite／full、2D／3D、迟到素材及销毁后无模型残留。这不是完整 WS／Worker 对局验证。

Chrome 页面／控制台／HTTP 错误为零；Firefox 保留主线既有 data URL connect-src CSP 诊断，HTTP／控制台错误为零。完整本机模拟／golden 继续暂停，完整回归交主线 Actions。

## 素材核对

实际重提取 MAP10 的三个场景及独立炮架、11 份 FX。最终 container 选择器定位到原 token 包；1030 三角形／117420 字节的炮架与截图包逐字节相同，详情见 model-source-check.json。既有完整 FX 索引的 units／skills／skins／projectiles／prefabs 与本次重提取结果比对一致。

发射 clip 的首姿炮口注册及 trapMaterial 光照近似仍需同视角校准。多个合格乘客按稳定生成顺序选择，保留 [ASSUMED]。

本分支保存审阅用截图和官服录影片段，独立于源码 PR；提取的游戏素材留在本机。
