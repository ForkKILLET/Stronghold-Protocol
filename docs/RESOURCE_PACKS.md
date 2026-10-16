# 预载资源传输分包

### 16 MB 预载传输分包

`tools/resource_packs.py` 按预载分类生成最终不超过 **16,000,000 bytes** 的 ZIP 包。
分包索引保存完整 SHA-1，并按 ZIP 文件自身摘要前 12 位命名，例如
`spine-01-3f8a1c2d4e5f.zip`；内容变化会自然产生新 URL，CDN 可按 immutable 长期缓存。
ZIP 条目固定为 1980-01-01 00:00:00、Unix 普通文件 0644，打包时间、宿主系统或权限不进入内容身份。
包内 `resourceVersion` 仅由本包有序资源列表（URL、大小、短/完整 SHA-1）派生，不嵌入全局清单版本；
外层 `resource-packs.json.resourceVersion` 仍对应输入清单版本。素材与分包成员不变时，重复打包的 ZIP
字节、文件名和整包 SHA-1 相同；其他分类更新不会使本包失效。首次采用此规则会产生一次新包哈希。
同一分类仍按 URL 排序、顺序填满 16 MB：增删资源或改变大小可能移动后续分包边界，因此不保证同分类
未修改文件所在的后续包哈希不变；这与每次打包的全包无条件变化不同。
包只是传输优化，仍按当前资源清单 URL、大小和指纹身份写入现有单一 Cache Storage；
索引或包缺失、失败时自动回退逐文件下载。

按 `ui`、`character`、`map`、`spine`、语音、音效、音乐和其他资源及 tier 分包；
首次缺失比例达到包内容的 25% 才使用包，小版本更新仍按文件增量，避免为小改动下载整包。
ZIP 使用 stored entries，最终 ZIP 大小（包含清单和 ZIP 开销）才是 16 MB 限制。
所有已选范围（包括皮肤）的分包先进入传输队列，全部处理后才进行逐文件补缺，
避免少数慢文件阻塞后续皮肤分包。部分文件失败保留计数并显示未完成，可点击继续下载重试。
预载最多并发请求两个分包；接收响应流时同步解析并取出 stored 条目，下载速度、总字节进度和缓存导入进度分别显示，
使后续 ZIP 下载能与前一包的缓存导入重叠。资源条目暂存受有界包队列约束。
分包下载完成后校验索引中的**整包 SHA-1**，并比对内嵌清单与包索引的 URL、size、hash，再导入匹配当前资源清单的已选项；
不再对可信分包内每个资源重复 SHA-1 或 CRC。路径/顺序、ZIP stored 本地头、声明大小和整包摘要仍需通过。
未选择的包成员仍被流式读取并纳入整包摘要，但跳过保留。这个加速仅针对部署端生成且带 HTTPS 资源包索引的分包；
用户手动导入的通用 ZIP 仍逐文件校验 CRC、实际大小和资源摘要。

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

### ZIP 下载多线路与路径重写

在游戏服务进程设置 `SP_RESOURCE_PACK_ROUTES`，值为按优先顺序排列的 JSON 字符串数组。
服务端将线路写入资源清单，下载器自动逐条尝试，玩家无需选择线路或修改设置。
**当前 `SP_ASSETS_CDN` 对应的 ZIP 地址自动放在最后**，未设置 CDN 时最后使用原站地址；
相同地址自动去重，即使提前写入 CDN 也仍将它放到最后。不配置本变量时继续使用原下载地址。

Docker Compose 示例（在游戏服务的 `environment` 下）：

```yaml
environment:
  SP_ASSETS_CDN: https://cdn.example.com/game
  SP_RESOURCE_PACK_ROUTES: >-
    ["example.com/data/", "https://backup.example.com/downloads/{file}"]
```

假设包名为 `ui-01-0123456789ab.zip`，将依次访问：

1. `https://example.com/data/ui-01-0123456789ab.zip`
2. `https://backup.example.com/downloads/ui-01-0123456789ab.zip`
3. `https://cdn.example.com/game/resource-packs/ui-01-0123456789ab.zip`

线路可填写目录（自动追加原 ZIP 文件名）、含 `{file}`（完整文件名）或 `{id}`（包 ID）的模板、
或完整 ZIP 地址，例如 `example.com/data/xxx.zip`；省略协议默认 HTTPS，也支持 `/mirror/{file}`
这样的同源路径。完整 ZIP 地址会用于每个包，多包部署通常使用目录或 `{file}` 模板；
`{id}.zip` 可用于镜像端按 ID 重命名，但发布时需自行处理版本更新。只接受 HTTP(S) 或站内根路径，
不接受账号密码、查询参数、片段或协议相对地址。无效配置会阻止启动，避免静默忽略线路。

HTTP 错误、网络/CORS 错误、响应流中断、ZIP 格式/大小/摘要校验失败都会尝试下一条线路。
每条线路连续 30 秒未收到有效数据或总下载超过 180 秒也会换线；所有 ZIP 线路失败后沿用逐文件补缺。
用户暂停、切换资源范围和战斗暂停会中止下载，不触发下一线路。换线时丢弃该次未验证的包内容，
当前包字节进度重新开始；下载速度包含失败尝试的实际接收字节，仍保留最多两个 ZIP 并发和流式解包。
资源导入前始终验证原索引的整包 SHA-1，缓存键、包内资源 URL/指纹、可选范围不随线路变化。

所有线路必须提供**同一份 ZIP 字节**，并为游戏域名配置 CORS（如 `Access-Control-Allow-Origin: *`）。
HTTPS 游戏页面应使用 HTTPS 镜像，避免浏览器混合内容拦截。ZIP 仅在浏览器与镜像之间下载，游戏服务不代理流量。
无需重新生成 ZIP/索引；部署新代码后重新构建客户端、更新 `public/resource-sw.js` 并重启游戏服务，
以后修改线路环境变量只需重启服务，新打开或刷新的页面会读取新线路。

主分支不再提供通用图片/音频 shrink 转换工具；生成分包不会转换素材。已有 WebP/atlas 及 HTTP 预压缩读取兼容保留。

验证：`node --test test/resources/pack-routes.test.js test/resources/resource-packs.test.js test/resources/index.test.js test/resources/archive.test.js test/resources/store.test.js`。测试不等同于浏览器或生产验证。
