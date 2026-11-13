# 雪地旧贴图渲染根因调查（2026-11-14）

用户已确认 `8832d14e` 的兼容处理在原受影响 Edge 设备上正常。此前提供的显卡型号为
NVIDIA GeForce RTX 3060 Laptop GPU；`edge://gpu` 截图显示 Canvas、Compositing、Rasterization
及 WebGL 硬件加速。随后收到原设备像素报告，确认 Edge 主版本 157、RTX 3060 Laptop 的
ANGLE D3D11；完整浏览器构建及驱动版本仍未知。结果见[原设备诊断分析](snow-albedo-device-result-20261114.md)。
本轮继续调查旧版本原因，没有回滚生产修复或更改游戏运行时。

## 当前能确定与不能确定的内容

修复只改变两张雪地图的材质 `map` 引用并增加共用贴图；新旧 RGB 完全一致，几何、光照、
地形及单位逻辑不变。因此已将问题收敛到旧贴图及其处理／身份链路。
但修复**同时**移除 alpha、从有损改为无损 WebP，并改变 URL／缓存身份，不能只凭成功就
断言是哪一环节，也不能给 RTX 3060 或其驱动定责。

若发生预乘，旧图像素 `(146,146,146,0)` 会变为 `(0,0,0,0)`，随后反预乘也无法恢复原色。
这能解释灰色地砖变黑、正 alpha 的冰块仍可见，但目前只是可检验的机制解释。

## 本项目绘制链路复核

- `resourceNetwork.js:loadRuntimeImage`：下载 Blob → 临时对象 URL → `new Image()`，不经过 Canvas2D。
- `makeTexture`：`THREE.Texture(image)`，sRGB、mipmap、线性过滤；未覆盖默认 `premultiplyAlpha=false`。
- 实际 vendor 为 Three r186，与依赖 `0.186.1` 的相关源码一致。上传显式设置
  `UNPACK_PREMULTIPLY_ALPHA_WEBGL=false` 与 `UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE`，
  通常使用 `texStorage2D`＋`texSubImage2D`；颜色贴图内部格式为 `SRGB8_ALPHA8`，之后生成 mipmap。
- `MT_icewild` 和 `MT_icewild_reflection` 为 opaque：`transparent=false`，Three 对普通 opaque
  材质禁用 blending；`uCutoff=0`，alpha=0 不满足 `<0` 的 discard 条件。该 alpha 不参与 RGB 光照。
  `alphaToCoverage` 保留默认 false，绘制状态会关闭 `SAMPLE_ALPHA_TO_COVERAGE`。
- `BoardScene` 自建独立 WebGLRenderer，`alpha:false`，不与 Pixi 共用上下文，不经另一画布复制。
  最终 shader 虽输出贴图 alpha，但不能据此声称 opaque 地面按 alpha 混合消失。
- Three 仅在图像超过 `MAX_TEXTURE_SIZE` 时使用 Canvas2D 缩小。本图为 2048×2048；诊断页会记录
  实际上限。未取得该值前，不将这条条件路径当作本次已发生的事实。

## 浏览器实现依据及其限制

[WebGL 规范](https://registry.khronos.org/webgl/specs/latest/1.0/#DOM_TEX_IMAGE_SOURCES)要求
HTMLImageElement 在不预乘上传时保留未预乘的 RGB；`alpha:false` 时页面合成忽略
`premultipliedAlpha` 标志。Canvas2D 中转则可能损失透明像素颜色。

检查 Chromium 固定提交 `5c0b8428e9734b96700912add679238262439d88`：

- [WebP 解码器](https://chromium.googlesource.com/chromium/src/+/5c0b8428e9734b96700912add679238262439d88/third_party/blink/renderer/platform/image-decoders/webp/webp_image_decoder.cc)
  支持预乘和未预乘输出，并非无条件预乘。
- [WebGL HTMLImageElement 上传入口](https://chromium.googlesource.com/chromium/src/+/5c0b8428e9734b96700912add679238262439d88/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc)
  将期望 alpha 类型交给 ImageExtractor，再走纹理上传。
- [ImageExtractor](https://chromium.googlesource.com/chromium/src/+/5c0b8428e9734b96700912add679238262439d88/third_party/blink/renderer/platform/graphics/gpu/image_extractor.cc)
  在需要时重新解码，并明确请求未预乘输出。因此“普通图片解码预乘了”不足以解释 WebGL 结果。

源码摘要见 [来源记录](snow-albedo-root-cause-20261114.json)。这是本轮获取的 Chromium 源码，
**不是玩家未知 Edge 版本的同版源码**，只能说明预期处理与排查方向，不能证明其实际分支或已有缺陷。

## 独立诊断页

生成器 `tools/research/snow-alpha-probe.py` 读取仍保留的旧贴图和现有 RGB 副本，生成离线单文件 HTML。
旧文件不改动，二进制和生成 HTML 不入 Git。无需回滚游戏、登录或修改设置；点击后才创建一个
WebGL2 上下文。CSP 禁止网络请求，无账户／存储／Service Worker 操作，结果只在本页显示并手动保存。

内嵌四个真实尺寸图像，离线逐像素验证生成控制组：

| 图像 | RGB | Alpha | 用途 |
|---|---|---|---|
| 旧有损 WebP | 旧文件原字节 | 旧值 | 复现原输入 |
| 无损 WebP RGBA | 与旧文件解码结果相同 | 旧值不变 | 单独替换编码方式 |
| PNG RGBA | 与旧文件解码结果相同 | 旧值不变 | 更换解码器对照 |
| 线上无损 WebP RGB | 与旧文件解码结果相同 | 全部为 255 | 已确认有效的输入 |

从 atlas 多个 alpha 档位抽取 12 个亮色像素，用离线 Pillow 读值作为 LOD0 期望，**不以浏览器
Canvas2D 读值当原图基准**。逐项读回原始 RGBA 字节上传、HTMLImageElement、RGBA8／SRGB8_ALPHA8、
texImage2D／texStorage2D＋texSubImage2D、显式不预乘 ImageBitmap、以及前三层 mipmap。
默认帧缓冲为 `alpha:false`，分别输出 alpha=1、原 alpha 和 alpha 灰度，RGB 与 alpha 分开记录。
Canvas2D 中转是预期可能丢色的正对照，其失败不能算作游戏路径的失败。
格式／上传 API 对照分别创建新的 HTMLImageElement，另读回原图首次／重复上传以记录缓存差异。

生成命令（仍必须经本机内存隔离；Python 需 Pillow）：

```sh
npm run check:local -- --small python3 -B tools/research/snow-alpha-probe.py \
  --output .state/snow-root-cause-20261114/snow-alpha-probe.html
```

将生成的 HTML 交给原玩家，用**原 Edge** 本地打开，点击“开始诊断”，完成后保存 JSON。
JSON 包含 UA、可获取的 GPU／ANGLE renderer、上下文参数、图像身份和各路径采样结果，不上传任何数据。

## 如何判断结果

| 观测（先要求原始字节对照和固定 RGB 对照正常） | 可继续收窄的范围 |
|---|---|
| 所有含 alpha 的图都丢色，RGB 图正常 | alpha 处理路径；仍需结合 ImageBitmap 和上传 API 区分 |
| 仅旧有损 WebP 失败，无损 RGBA 和 PNG 正常 | 有损 WebP 的解码／转换分支，不能单归因于 alpha 存在 |
| HTMLImageElement 失败，显式不预乘 ImageBitmap 正常 | 两种图像来源的解码／提取／上传处理差异 |
| RGBA8 正常，仅 SRGB8_ALPHA8 失败 | sRGB 格式的转换／上传／采样路径 |
| texImage2D 正常，texStorage＋texSubImage 失败 | 存储分配／子图上传路径 |
| LOD0 正常，旧图 mip RGB 与固定 RGB 对照不同 | mipmap 路径；不能拿 LOD0 原色直接判定 mip 的对错 |
| 所有诊断路径正常 | 最小诊断未复现；回到原完整帧检查采样过滤、状态、资源身份及呈现，不能宣称已证明根因 |

这些结果只能定位到路径；要归因特定 Chromium／ANGLE／驱动缺陷，还需实际版本与更小的重复实验。
本轮已通过 2 项 CPU 定向检查（包括生成器的控制组像素、原文件不变与拒绝错误对照），JS 语法和
ESLint 通过，真实图像离线页生成成功（约 13.68 MiB），峰值约 201 MiB，OOM 计数为零。
浏览器、完整模拟及 golden 仍暂停；未运行此页，未宣称 GPU 采样已核验。结果等待原设备补充。

后续原设备结果：9 项非 Canvas2D 路径在 12 点的 LOD0 均零误差，同格式 sRGB 的前三层 mip
与修复图也一致；仅正对照丢色。此页没有复现故障，不能据此归因解码、上传或驱动。
后续已准备真实静态地图 A/B 页，详见[分析与后续工具](snow-albedo-device-result-20261114.md)。
