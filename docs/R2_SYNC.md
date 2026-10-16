# R2 同步

R2 没有原生 `rsync` 协议。本项目使用配置了 Cloudflare R2 S3 API 的
`rclone copy`/`rclone sync`，按校验值增量同步，可重复执行以补传失败文件：

```text
public/assets/          -> <R2_TARGET>/assets/
public/fonts/           -> <R2_TARGET>/fonts/                 (if present)
public/i18n/            -> <R2_TARGET>/i18n/                  (if present)
public/resource-packs/  -> <R2_TARGET>/resource-packs/        (if present)
packs/                  -> <R2_TARGET>/packs/                 (if present)
data/                   -> <R2_TARGET>/data/
```

`data/resource-packs.json` 存在时，其声明的 ZIP 必须存在且大小一致；有 ZIP 时也必须有索引。
同步前会在临时目录从当前源数据与素材清单生成 `data/resource-manifest.json`，
并将包 URL 改写到 `ASSETS_CDN_BASE_URL`。完整 `data/` 文件树一起上传，包含
`data/i18n/`、`local-assets.json`、`local-fx.json` 和 `resource-packs.json`。

## 推荐：部署机使用 JSON 配置

部署机需要 Node.js 22+、Bash、rclone 和 curl。复制示例并填写凭据：

```bash
cp config/r2-sync.example.json config/r2-sync.json
chmod 600 config/r2-sync.json
```

配置中的 `r2` 填 R2 Account ID、S3 Access Key ID、Secret Access Key、bucket 与可选路径
`prefix`；`cdn.dataBaseUrl` 与服务端 `SP_DATA_CDN` 一致，`cdn.assetsBaseUrl` 与
`SP_ASSETS_CDN` 一致。这两个值都是根目录，不要追加 `/data` 或 `/assets`；
公开域名的路径必须与 bucket 的 `prefix` 映射一致。

`cloudflare` 填 Zone ID 和具有该 Zone Cache Purge 权限的 API Token。
`purgeMode` 默认 `prefixes`，仅清理配置中 CDN 对应的 data、assets、fonts、语言和 ZIP 路径；
也支持 `hosts`（整个 CDN 主机）或 `everything`（整个 Zone）。API 权限/套餐不支持所选方式时，
脚本报错退出；不会自动扩大清理范围。两个 CDN 主机应属于配置的同一 Zone。

`sync.transfers` / `sync.checkers` 默认 32 / 64；`sync.packRoutes` 沿用
`SP_RESOURCE_PACK_ROUTES` 的有序线路数组格式。`sync.mirror` 默认 false。

`config/r2-sync.json` 已被 Git 和 Docker 构建上下文忽略。脚本在权限受限的临时目录生成
rclone/curl 配置，退出后删除，不修改已有 rclone remote，不将凭据放进命令参数。

```bash
# 默认读取 config/r2-sync.json，只预演；预演可能读取远端清单，但不写入、不清缓存。
bash scripts/sync-to-r2.sh
# 在部署机实际上传
bash scripts/sync-to-r2.sh --apply
# 也可指定配置路径
bash scripts/sync-to-r2.sh --config /srv/private/r2-sync.json --apply
```

全部素材、字体、语言包和 ZIP 成功后才上传 data，最后清 CDN 缓存。任一步失败立即退出；
上传失败不执行缓存清理。缓存清理失败也返回非零状态，修复权限后可重复执行补齐。
普通模式不删除远端对象；`--mirror` 或 `sync.mirror: true` 会删除各同步前缀中本地不存在的对象。

## 兼容：环境变量与已有 rclone remote

先在部署机安装 `rclone`，然后创建 R2 remote：

```bash
rclone config create r2 s3 provider Cloudflare \
  access_key_id "$R2_ACCESS_KEY_ID" \
  secret_access_key "$R2_SECRET_ACCESS_KEY" \
  endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

不要把 Access Key、Secret Key 或 `rclone.conf` 提交到仓库。

设置与 R2 路径一致的 CDN 公共基址、Cloudflare Zone ID 与有缓存清理权限的 API Token：

```bash
export R2_TARGET=r2:stronghold
export DATA_CDN_BASE_URL=https://data.example.com/stronghold
export ASSETS_CDN_BASE_URL=https://assets.example.com/stronghold
export CF_ZONE_ID=0123456789abcdef0123456789abcdef
export CF_API_TOKEN=... # Zone Cache Purge 权限
```

R2 自定义域/公开地址需将上述 URL 前缀映射到同一个 bucket 的 `data/` 与 `assets/`
对象前缀。`DATA_CDN_BASE_URL` 必须与游戏服务 `SP_DATA_CDN` 一致；
`ASSETS_CDN_BASE_URL` 必须与 `SP_ASSETS_CDN` 一致。

### 环境变量模式的使用

默认只预演，不上传、不删除 R2 对象。默认是增量上传模式，不删除 R2 中已有对象：

```bash
R2_TARGET=r2:stronghold bash scripts/sync-to-r2.sh
```

确认计划后执行：

```bash
R2_TARGET=r2:stronghold bash scripts/sync-to-r2.sh --apply
```

环境变量模式下，所有目录上传成功后，脚本自动调用 Cloudflare Purge Cache API 清理**整个 Zone** 的缓存。
因此该 Zone 上不属于本游戏的缓存也会失效；若同 Zone 托管其他站点，应先为游戏 CDN
使用独立 Zone，或改用上面的 JSON 配置选择 `prefixes`。

需要让 R2 目标严格镜像本地目录时，显式加 `--mirror`；该模式会删除各目标前缀中本地已经不存在的对象：

```bash
R2_TARGET=r2:stronghold bash scripts/sync-to-r2.sh --apply --mirror
```

也可以同步到 bucket 下的版本前缀：

```bash
R2_TARGET=r2:stronghold/releases/2026-10-16 \
  bash scripts/sync-to-r2.sh --apply
```

客户端所有 `/data/*.json`、`/data/i18n/*.json` 和游戏文本包 `/packs/<id>/texts/*.json`
均使用运行时 `DATA_CDN`，包含静态数据、资源清单、ZIP 包索引、本地素材/特效清单。
`/js/asset-cdn.js` 与服务端自己的数据读取仍留在游戏源站；服务器仍以本地 `data/`
启动、校验和运行。UI 语言 `/i18n/*.json` 仍跟随 `ASSETS_CDN`。

脚本移除 `--check-first`，边检查边上传，并使用 `--fast-list` 减少远端列目录请求，
代价是增加目录清单的内存占用。默认 32 路传输和 64 路检查；可通过
`R2_TRANSFERS`、`R2_CHECKERS` 调整。生成的 `resource-manifest.json` 位于临时工作目录，
不会覆盖本机数据清单；同步过程中不会修改本地文件。
只有 `--mirror` 会额外使用 `--delete-after`。

已有 JSON 配置中的 `sync.transfers` / `sync.checkers` 优先于默认值；若仍填写 8 / 16，
请在部署机改为 32 / 64 后重新运行脚本。若超时或重试增多，可降低并发。

上传的 data 和 packs 使用 `Cache-Control: no-cache`，其他素材使用一天缓存；
为 R2 自定义域配置 CORS，允许游戏源站跨域 GET/HEAD。游戏服务器仍需保留完整本地 data。
相关接口依据 [rclone R2 文档](https://rclone.org/s3/#cloudflare-r2) 和
[Cloudflare Purge Cache API](https://developers.cloudflare.com/api/resources/cache/methods/purge/)。
