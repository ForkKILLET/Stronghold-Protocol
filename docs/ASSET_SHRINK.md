# 资源压缩与双格式迁移手册

2026-10-14，本分支的离线发布工具。源码实现不等于已经转换或部署素材：
本次只用隔离小样例验证，没有更改真实 `public/assets/`、素材清单或线上服务。
素材仍属权利人，不能提交到 Git。工具不合入上游的素材 URL 内容哈希路由。

## 当前能力与限制

### 16 MB 预载传输分包

`tools/resource_packs.py` 按预载分类生成最终不超过 **16,000,000 bytes** 的 ZIP 包。
每个包完成后按 ZIP 文件自身 SHA-1 前 12 位命名，例如
`spine-01-3f8a1c2d4e5f.zip`；内容变化会自然产生新 URL，CDN 可按 immutable 长期缓存。
包只是传输优化，文件仍按当前资源清单的 URL、大小和 SHA-1 校验，并写入现有单一
Cache Storage；索引或包缺失、失败时自动回退逐文件下载。

按 `ui`、`character`、`map`、`spine`、语音、音效、音乐和其他资源及 tier 分包；
首次缺失比例达到包内容的 25% 才使用包，小版本更新仍按文件增量，避免为小改动下载整包。
ZIP 使用 stored entries，最终 ZIP 大小（包含清单和 ZIP 开销）才是 16 MB 限制。

```powershell
python tools/resource_packs.py `
  --manifest data/resource-manifest.json `
  --assets-root public `
  --output public/resource-packs `
  --index data/resource-packs.json
```

`data/resource-packs.json` 和 `public/resource-packs/` 是部署生成物，不提交素材。
先上传同版本 ZIP，再上传索引；包导入与逐文件下载共享资源锁和战斗暂停边界。
包不携带可信缓存索引、删除指令或新的资源身份，不能与其他版本清单混用。
启用 `SP_ASSETS_CDN` 时服务端会把包 URL 改写为 CDN 地址；Docker 镜像不包含
`public/resource-packs/`，只需发布到 CDN。包访问失败会回退逐文件预载。

`tools/shrink-assets.py` 默认 dry-run，只有 `--apply` 才修改候选资源；`--json` 指定的报告
是 dry-run 唯一允许写入的输出。推荐复制到新的候选目录，而不是在活跃服务目录执行。

- 普通图片、棋盘颜色图：WebP quality 95 / method 5；既有玩法说明 quality 90 / method 4 保持。
- Spine 图集页：无损 WebP，保留全 RGBA，包括透明像素中的 RGB。
- 法线、粗糙度、金属/高光、Mask、Emission、Lightmap 和水纹/噪声等数据图：无损。
  优先使用本地清单的 `kind`、`derive`，并以 `_N/_M/_E`、`normal`、`mask`、
  `lm` 后任意数字等命名补足。旧 `webp: "lossy"` 不能覆盖 Lightmap 等语义。
- 两类表情目录 `assets/ui/emoticon`、`assets/local/emoticon` 始终保留 PNG；
  `--include-emoticons` 明确拒绝，不能与固定运行时表情路径不一致。
- 小图转换后比 PNG 大且尚无 WebP 副本时，保持 PNG。
- PNG 原件不移动、不删除。已有 WebP 不因“文件存在”而自动信任，首次执行从 PNG
  重编码并校验；旧有损 Lightmap 也会从保留的原 PNG 重新生成无损 WebP。
- `.skel/.bin` 的原始字节不变。`.br`（q5）或缺 Python brotli 时的 `.gz`（gzip-6）
  是 HTTP 预压缩副本；始终保留原文件，`--drop-raw` 明确拒绝。
- `all` **不包含音频转码或硬链接去重**。`dedupe` 只报告，不修改文件。
- 音频只能显式执行 `audio`：私人候选中的单声道语音、SFX 转 MP3 48 kbps；
  BGM、立体声、已不高于 48 kbps 的文件不转。校验声道、采样率和时长。
  这是二次有损编码，发布前必须人工试听；不能承诺无音质损失。

PNG/WebP、atlas 和三个清单都保持对应。每次替换旧 WebP/清单/预压缩副本前，复制旧字节到
候选的 `.cache/asset-shrink-backups/`，以完整 SHA-1 后缀区分版本；不覆盖旧备份。
新文件用同目录临时文件原子替换。源 PNG、原 atlas、原二进制从不被搬走。

转换记录存于 `.cache/asset-shrink-state.json`，绑定源 SHA-1、目标 SHA-1、策略及编码参数。
重复执行校验两份字节后跳过；原件、输出或策略变化时重新生成。损坏输入退出码为 1，
阻止后续 atlas/清单/指纹阶段；已经完成的候选副本和记录保留，可以修复输入后继续。
这个记录不是资源 ZIP 的摘要豁免，不提交、也不发布给浏览器。

## Spine 双轨

原有 `x.atlas` 继续引用 `x.png`；新的 `x.webp.atlas` 引用已验证的 `x.webp`。
清单的 `atlas`、`textures` 和本地 `spineLocal` 别名一起切换，骨骼 `x.skel` 不变。
新客户端用 pixi-spine 的 `spineAtlasFile` 选择变体；卸载、失败重试与页纹理清理都
使用实际清单路径。不要修改原 atlas 的页名，否则旧 SW 中的 atlas 会与新页面混用。

旧页面已经读取的旧清单和旧 URL 仍能加载原件。应当先部署新客户端，再切换新清单：
旧代码未识别新本地 atlas 时可能回退到 web 模型，不能把“旧 URL 保留”解释为任意旧代码
均能读懂新清单。新 URL 仍是普通路径，没有内容哈希路由。

## 安全执行

需要 Python 3.10+、支持 WebP 的 Pillow。可以使用已经安装提取依赖的 `.venv-extract`。
预压缩可选 `pip install brotli`，缺少时输出真正的 gzip，不是 zlib 格式。
Node 使用项目支持的版本（至少 22）；本机验证采用 22.23.3。

仅检查（不转换真实资源）：

```powershell
.venv-extract/Scripts/python.exe -B tools/shrink-assets.py verify
.venv-extract/Scripts/python.exe -B tools/shrink-assets.py webp --limit 20 `
  --json .cache/shrink-trial.json
```

制作**新的私人候选**，不会覆盖已存在的候选目录：

```powershell
.venv-extract/Scripts/python.exe -B tools/shrink-assets.py all --apply `
  --output .cache/resource-release-candidate `
  --node .cache/node22-monitoring/node.exe `
  --json .cache/resource-release-report.json
```

此命令复制 `public/assets`、可选 `public/fonts` 与 `data/assets.json`、
`local-assets.json`、`asset-hashes.json`，不复制公告、游戏存档或其他源码。
执行 WebP → atlas 变体 → 清单 → 预压缩 → 原字节指纹；没有音频转码。
候选不是完整源码项目，也不是可直接启动的服务端发行包。

修复部分失败后，继续使用该候选：

```powershell
.venv-extract/Scripts/python.exe -B tools/shrink-assets.py all --apply `
  --root .cache/resource-release-candidate `
  --node .cache/node22-monitoring/node.exe
```

分步执行时使用同样的 `--root`。`webp` 只生成副本和转换记录；然后需要 `atlas`、
`manifest`。`manifest` 和 `audio` 完成后会自动运行 `asset-hashes.mjs --root <候选>`。
最后校验：

```powershell
.cache/node22-monitoring/node.exe tools/asset-hashes.mjs `
  --root .cache/resource-release-candidate --check
```

显式 `--in-place` 才可对当前源码根目录 apply，但它仍不适合在线发布；
不要在服务正在读取清单时顺序替换多个文件。音频 apply 一律要求私人候选。
来源目录包含越界 symlink/junction、候选位于来源 public 目录、候选覆盖来源、
备份位于 public 内或清单路径包含遍历时拒绝。候选复制是实际磁盘复制，要准备额外空间。

`npm run assets` 或再次提取会重新生成上游路径。压缩是发布后处理，**下载/提取完成后**
再在私人候选中执行；不要直接对改写后的清单再次运行下载以期它保持不变。

## HTTP / CDN

Node 为 `public/assets` 和 `public/fonts` 中可压缩原件选择同目录新鲜 `.br/.gz`：

- 按现有 Accept-Encoding 规则选择编码；
- 保留 MIME、一天缓存、`Vary: Accept-Encoding`、编码区分的 ETag、GET/HEAD/304；
- ETag 包含副本的 size/mtime，重生成副本会改变验证器；
- 缺少或较旧的副本回退动态压缩；副本越过原件真实目录的符号链接不读取；
- Range、identity 和不接受该编码的请求使用原件；
- 代码、配置、游戏数据不使用这个预压缩副本入口；
- 原件缺失仍 404，不支持“只剩 .br”的部署。

源站/CDN 静态服务需自行启用 `brotli_static on`（需要对应模块）或 `gzip_static on`。
保留原件和副本，不能无条件把 `.br` 返回给 identity 客户端。
原件与副本必须原子成组发布且解压后完全一致，勿依靠时间戳代替发布前内容校验。
Nginx 配置、HTTPS、跨域响应头及缓存刷新需要在实际部署环境验收。

指纹、预载大小和 ZIP 始终针对**解码后的资源原字节**，不把 `.br/.gz` 列入资源包。
这是传输/CPU 优化，不是浏览器预载容量减少：已有 Node 动态 Brotli 压缩时，
新增副本并不再省同等网络流量，保留原件也会增加服务器磁盘占用。
WebP 才改变图片正文和缓存容量；不能继续使用旧 PNG 指纹。

## 服务端发布顺序

1. 备份旧镜像、三个旧清单、旧 CDN 素材与数据目录；保留当前公告、环境和 Redis 卷。
2. 先发布新源码并 build，确认新客户端支持显式 atlas 变体和预压缩。
3. 上传新 WebP、新 atlas、原件及预压缩副本；**不要使用删除旧文件的同步方式**。
4. 校验目标 CDN 的文件/MIME/CORS，解码后摘要与候选清单一致。
5. 再切换 `assets.json`、`local-assets.json`、`asset-hashes.json`；
   游戏源站、DATA_CDN 和 ASSETS_CDN 必须是同一个发布版本。
6. 重建/重启对应容器，确认旧 bind mount 没有覆盖新清单；更新 SW，让非对局页面刷新。
7. 检查 `/healthz.build`、运行时 CDN 地址、源站预载清单无合成指纹、
   3D 场景、干员模型、透明边缘、声音、预载及 ZIP 导入导出。
8. 旧 PNG/atlas 至少保留到旧页面退出及升级窗口结束，再另行安排服务器清理。
   本工具没有自动删旧资源命令。

需将候选三个清单加入**完整匹配版本**的 `data/` 后同步实际 Nginx 数据目录。
现有 `scripts/copy-data-to-nginx.sh` 只复制 data，不复制素材：

```sh
sudo bash scripts/copy-data-to-nginx.sh ./data /opt/1panel/www/sites/wei.linxia.dev/index/srv
```

不能把候选只含三个文件的 data 目录当作完整游戏数据更新。
回滚时一起恢复代码、三个清单、CDN 对应字节；音频同 URL 或已有 WebP 被替换时也要
恢复原字节并刷新 CDN。没有验证跨版本进行中对局恢复，不做无停机保证。

## 已有浏览器缓存与旧资源包

| 更新类型 | 旧资源处理 |
|---|---|
| `.skel/.bin` 只新增 HTTP `.br/.gz` | URL/解码字节/指纹不变，无需重新预载 |
| 仍保留 PNG 的表情、小图 | 同路径同指纹继续复用 |
| PNG → WebP | URL 和字节不同，只下载对应 WebP，不把 PNG 伪装成 WebP |
| `.atlas` → `.webp.atlas` | 下载新 atlas，旧 atlas URL 继续可访问 |
| 既有 WebP 改为无损 / 音频重编码 | 同 URL 指纹变化，预载会重新获取变化文件 |

不改缓存名、不主动清空整包、不在浏览器重新编码 PNG、不更改用户预载范围或战斗暂停规则。
已有旧版 cache-layout 的同 URL 同字节资源可通过既有校验迁入当前缓存。
现有下载完整集合后才清理旧条目；仅勾选必备时，不保证清理所有旧可选资源。
暂停、空间不足或失败时保留已完成资源，可能暂时同时占用 PNG/WebP 两份空间。
不要要求玩家升级前先点“清理缓存”；存储不足需说明其将重新下载，而不是宣称无损迁移。

运行时 SW 图片 cache-first 不自动知道当前清单的指纹。关闭预载的用户不保证立即
替换同 URL 的旧 WebP；音频在线 network-first，但 HTTP/CDN 仍有缓存期。
因此先刷新页面/更新 SW，再检查资源或开启所选预载；发布时清理相关 CDN 缓存。
预载校验后重试仍不匹配时现在报错，**不**给旧字节登记新指纹。

旧 ZIP 继续校验 CRC、大小及版本摘要，只有当前服务器同路径同指纹文件才写入。
PNG 改 WebP 后不能从旧 PNG ZIP 得到新 WebP，但旧骨骼/字体等可复用；
新增/变化 WebP、atlas 和音频由新增量包提供。
`tools/resource_delta.py` 已同步 11 个官方场景的 `scene.json` 白名单。
不允许其他游戏/语言 JSON，也没有删除指令或二进制补丁。

交付建议分开提供：服务端新增素材包（目录文件）、浏览器新全量资源 ZIP、
旧包到新包的浏览器增量 ZIP，以及版本/摘要说明。
旧包先导入再导入增量；已有缓存只需增量。资源 URL/CDN host 改变时，
ZIP 按稳定路径写到新 CDN URL；普通现有缓存不保证直接跨域迁移，建议保持域名不变。
旧代码客户端不接受新清单时，先升级页面，不能把新资源 ZIP 当成代码升级包。

## 验证

只运行相关测试，不要求全量测试：

```powershell
python -B -m unittest discover -s test/resources -p "*_test.py"
node --test test/resources/precompressed.test.js test/render/resource-shrink.test.js `
  test/resources/archive.test.js test/resources/store.test.js test/resources/delta-script.test.js
npm run typecheck
npm run build
```

覆盖表情、数据图无损/透明 RGB、RGB+tRNS/调色板透明度、已有错误 WebP、清单/CDN/括号、
幂等、失败退出、原件保留、有效 gzip、候选与真实源隔离、Spine 变体、HTTP、
解码字节缓存/ZIP、旧 PNG ZIP 复用和 CDN 未完整发布。
自动化用合成小样例，不等于真实图片视觉验收、Safari/手机、Nginx、Docker 或生产验收。
请人工查看至少一个 Spine、多页 atlas、棋盘/场景/Lightmap、透明 UI 和说明页，
再做预载→导出→导入回环；未主动执行浏览器自动化。
