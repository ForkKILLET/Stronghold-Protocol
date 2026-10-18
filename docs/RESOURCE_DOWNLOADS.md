# 本服资源补给站

`/downloads/` 是无需登录的独立静态页，不加载游戏启动、账户或 WebSocket。游戏预载面板的「前往下载」指向此页。
独立 Nginx 容器与游戏共用现有 HTTPS 域名和端口，通过 Traefik 路径路由提供页面；不读取用户数据或游戏存档。

## 分类与导入

| 包 | 内容 |
|---|---|
| core | 必备地图、棋盘、默认模型、图片、界面及字体 |
| common | 官方特效、音效、音乐、个人头像、说明及本土／其他语音 |
| voice-cn / voice-jp / voice-en / voice-kr | 对应语言的角色语音 |
| skins | 已部署皮肤的模型、头像与立绘 |

推荐 core + common + 一种语音，皮肤按需追加。每个 ZIP 都能独立导入，无需解压；复用现有 v2
`stronghold-resources.json`、逐文件 CRC/大小/SHA-1 校验、旧版有效文件复用及缺失增量下载。
ZIP 只保存素材，不提供离线联机或账户数据。生成包与素材均不提交 Git。

```sh
python3 tools/resource_downloads.py \
  --manifest data/resource-manifest.json --assets-root public \
  --output /path/to/downloads \
  --previous /path/to/previous-downloads
node tools/build-downloads.mjs
```

工具按资源路径排序，以固定 ZIP 元数据流式写入，验证源文件与资源清单一致。全局资源版本、生成时间及
其他分类变化不进入某包身份；文件名包含 ZIP SHA-256 前 12 位，下载页和 SHA256SUMS 提供完整摘要。
同内容分类通过输入指纹复用已生成 ZIP，同文件系统上使用硬链接；变化时只生成受影响分类。
输出 `downloads.json` 在全部包完成后原子更新，目录与 SHA256SUMS 不使用长缓存，带内容指纹的 ZIP 可长期缓存。

`--mirror https://example.com/release-directory` 可重复设置相同文件的备用目录。镜像保持 ZIP 字节不变。
下载页只展示已提供的备用地址；不把网盘下载页当作游戏内自动预载线路。
原有自动传输 ZIP 继续限制为 16 MB，现在将皮肤和个人头像分开，避免未选择皮肤时下载混合包。

## 部署

实际部署脚本在个人配置仓库 `deploy/stronghold-protocol`：

```sh
./deploy/stronghold-protocol/deploy.sh --target downloads --plan
./deploy/stronghold-protocol/deploy.sh --target downloads --build-only
./deploy/stronghold-protocol/deploy.sh --target downloads --archive-github
```

下载目标从当前线上游戏镜像提取资源，使用指定提交的工具和页面，避免把尚未部署的素材误当成在线版本。
构建在 w2 执行，目录保存在 `/mnt/user/compose/stronghold-protocol/downloads/<release>/`，只读挂载给静态容器。
页面镜像与 ZIP 独立：只更新页面可复用上一发布的全部 ZIP；更新后保留旧目录供回滚，不自动删除。
该目标不等待对局、不停止或重建游戏／面板／Redis，并检查游戏容器身份未改变。
游戏内入口和自动分包调整需要随后按原有冷更新流程发布游戏；仅上线下载页不会修改旧游戏进程。

GitHub 归档使用 `resources-<资源指纹>` Release，与源码版本发布分开。验证完成后先上传相同 ZIP 及 SHA256SUMS，
再公开 Release 并把备用链接写入待发布目录；令牌仅经本机 keyring、SSH stdin 和 curl stdin 传递，不写文件、参数或日志。
上传失败保留草稿以便重试，不替换已存在的同名内容。网盘或其他镜像可日后追加，不影响固定站内入口。

Nginx 支持 Range 续传、ETag、附件下载与跨域读取。初始默认每请求 1 MiB/s、全局最多 4 个 ZIP 请求；
`SP_DOWNLOAD_RATE`（Nginx 单位，`0` 为不限速）和 `SP_DOWNLOAD_CONNECTIONS` 可在 Compose 中调整，后续更新保留现场配置。
页面、清单和字体不占 ZIP 下载并发配额。独立容器共享 w2 上行，不能把容器隔离等同于带宽隔离。

验证：`test/resources/downloads.test.js`、原资源包／ZIP 回归、`test/ui/downloads.e2e.test.js`（Chrome/Firefox，桌面／横屏／竖屏）；
部署候选和实际 HTTPS 验证清单、字体、ZIP 大小、Range 及 SHA256SUMS，避免经公网重复下载整套资源。
