# 原设备雪地像素诊断结果（2026-11-14）

用户提供 `snow-alpha-diagnostic.json`，原始 SHA-256 为
`752dfd60b5535785d55b73827338ae8718b44587445813dddb98bbcc4d51160e`。
报告 UTC 时间 `2026-11-13T16:39:16.903Z`，对应北京时间 11 月 14 日 00:39。
重算了全部采样误差，并核对各项的坐标、期望值、alpha 与结果长度；没有运行错误或缺项。
汇总见 [JSON 收据](snow-albedo-device-result-20261114.json)，不提交原用户文件。

## 结论与范围

**此诊断未复现旧游戏中的故障。它不支持此前“解码／上传时透明像素 RGB 被清零”的归因。**
不能把不复现扩大为旧游戏没有问题，也不能认定已经排除了所有纹理像素、过滤、呈现或缓存条件。
线上 RGB 修复继续保留，玩家已确认该版本正常。

实际上下文为 NVIDIA GeForce RTX 3060 Laptop GPU（`0x2520`），ANGLE Direct3D11，
`vs_5_0 ps_5_0`，WebGL 2.0。UA 为 Edge／Chromium 157（UA 精简为 `.0.0.0`，不是完整构建号），
驱动版本未提供。`alpha:false`，抗锯齿为 true；纹理上限 16384，因此本图 2048×2048 不会触发
Three 的超上限 Canvas2D 缩图分支。

报告中的 `premultipliedAlpha:true` 是画布创建属性，不能当作纹理上传的预乘开关。
诊断代码显式要求不预乘，且画布 `alpha:false`；原 alpha／强制 alpha=1 两种输出的 RGB 也完全相同。

| 对照 | 12 个 LOD0 点的 RGB 误差 | 同为 sRGB 的 mip 1／2／3，与修复图比较 |
|---|---:|---|
| 原始 RGBA 字节上传 | 0 | 不生成 mip |
| 原有损 RGBA WebP，storage＋subImage | 0 | 全部为 0 |
| 同一原图，RGBA8 存储 | 0 | 与 sRGB 内部格式不同，不用于相等判定 |
| 同一原图，texImage2D | 0 | 全部为 0 |
| 同一原图，重复上传 | 0 | 全部为 0 |
| 同一原图，显式不预乘 ImageBitmap | 0 | 全部为 0 |
| 无损 RGBA WebP | 0 | 全部为 0 |
| PNG RGBA | 0 | 全部为 0 |
| 修复版无损 RGB WebP | 0 | 基准 |
| Canvas2D 正对照 | 8／12 个点超过容差，最大 154 | 存在差异，符合该对照的用途 |

所有非 Canvas2D 路径中的三个 alpha=0 样本均保留 RGB，例如 `(144,145,154,0)` 采样后仍为
`(144,145,154)`。9 项非 Canvas2D 检查的 LOD0 最大误差均为零。Canvas2D 正对照的三个零 alpha
点变为黑色，但游戏加载链路没有发现这种中转；这不能成为其根因证据。
各 alpha 值均与期望一致（修复图全部 255）。前三个 mip 层只比较了对应位置，**没有覆盖整个 atlas
或所有 mip 层**。RGBA8 与 sRGB 分支的 mip 数值不可混在一个相等性断言中。

## 剩余差异与下一步

第一版诊断使用 `texelFetch` 定点读数，绕过线性／各向异性过滤；没有现有场景 shader、真实三角形、
完整画布呈现、其它 draw call 状态或对局内资源压力。真实场景设置线性 mip 过滤及最高 8× 各向异性。
这些是仍需调查的差异，**不是已发现的故障**。

已增加 `tools/research/snow-scene-probe.mjs` 与 `snow-scene-probe-browser.js`：

- 打包现有 Three r186、BoardScene、sceneMaterial、MAP9 原几何／光照和实际版本的地图布局；
  内嵌原图与修复图，无网络请求、账户、服务端模拟或生产改动。
- 普通、联防、Boss 三布局分别测试抗锯齿开／关；同上下文比较修复图重复帧、原图、原图强制
  输出 alpha=1、原图各向异性降为 1；记录整张画布 RGB 差异与实际上下文，而非只读 12 个点。
- 先检查修复图重复帧稳定。各向异性降为 1 时，旧图与同样降为 1 的修复图比较；修复图
  从 8 降为 1 的差异只作过滤变化对照，`equalityExpected=false`，不能误判为丢色。
- 仅两种诊断控制改变 shader 输出 alpha／各向异性；普通 A/B 复用原运行时 shader 和纹理配置。
  每次只保留一个 Three 上下文，重建前销毁旧资源；结束后可手动切换两张贴图观察画面并保存 JSON。
- 这是静态地图复现，**不含 Pixi、干员、持续 OfficialFx、真实 Match 状态或原对局资源压力**。
  若仍不复现，应进入原故障条件捕获真实帧与资源身份；不能继续从这个静态页断言根因。

```sh
npm run check:local -- --small node tools/research/snow-scene-probe.mjs \
  --output .state/snow-diagnostic-result-20261114/snow-scene-probe.html
```

已核验生成页的 12 个资源摘要、完整几何长度及三种布局的真实 Three 场景构造（每种四个原版场景 mesh，
其中两个受影响材质），脚本打包及 ESLint 通过，大小约 12.33 MiB。构造检查使用 stub renderer，
**不等于浏览器／GPU 验证**；本机浏览器、完整模拟及 golden 沿用暂停安排。峰值约 162 MiB，无 OOM。
下一份所需证据为原设备运行该静态地图页的 `snow-scene-diagnostic.json`，以及肉眼切换是否复现缺砖。
