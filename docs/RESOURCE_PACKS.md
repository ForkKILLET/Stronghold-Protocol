# 预载资源传输分包

### 16 MB 预载传输分包

`tools/resource_packs.py` 按预载分类生成最终不超过 **16,000,000 bytes** 的 ZIP 包。
分包索引保存完整 SHA-1，并按 ZIP 文件自身摘要前 12 位命名，例如
`spine-01-3f8a1c2d4e5f.zip`；内容变化会自然产生新 URL，CDN 可按 immutable 长期缓存。
包只是传输优化，仍按当前资源清单 URL、大小和指纹身份写入现有单一 Cache Storage；
索引或包缺失、失败时自动回退逐文件下载。

按 `ui`、`character`、`map`、`spine`、语音、音效、音乐和其他资源及 tier 分包；
首次缺失比例达到包内容的 25% 才使用包，小版本更新仍按文件增量，避免为小改动下载整包。
ZIP 使用 stored entries，最终 ZIP 大小（包含清单和 ZIP 开销）才是 16 MB 限制。
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

主分支不再提供通用图片/音频 shrink 转换工具；生成分包不会转换素材。已有 WebP/atlas 及 HTTP 预压缩读取兼容保留。

验证：`node --test test/resources/resource-packs.test.js test/resources/index.test.js test/resources/archive.test.js test/resources/store.test.js`。测试不等同于浏览器或生产验证。
