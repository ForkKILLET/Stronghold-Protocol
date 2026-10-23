# 服务器运行配置

`config/server.json` 集中管理容量、连接、恢复、Worker、保存周期和退出等待。启动时读取一次，修改后重启生效；文件不存在时沿用模块默认值。不要修改会发给浏览器的 `data/config.json`。

```sh
cp config/server.example.json config/server.json
node tools/server-config.mjs
npm start
```

生产中建议指定绝对路径：`SP_SERVER_CONFIG=/app/server-config/server.json`。显式指定的文件缺失、不可读、JSON 损坏、未知键或越界值都会阻止启动。默认路径缺失允许启动；整个文件及分组必须是对象。所有时间字段均为毫秒，所有数量为整数。程序调用 `startServer({serverConfigFile:null})` 可禁用文件读取。

优先级：**显式 `startServer()` 参数 > 环境变量 > 文件 > 模块默认值**。配置文件所有字段都会校验，被更高优先级覆盖的非法字段也不能悄悄通过。旧环境变量非法值保留原有回退语义，记录警告后使用文件或默认值。不会把文件内容写入全局 `process.env`，同一进程的多个测试服务器互不影响。

## 字段

| 分组 | 字段 | 环境变量 |
| --- | --- | --- |
| `limits` | `maxConnections`、`maxConnectionsPerAddr`、`maxRooms`、`maxRoomsPerAddr`、`maxMatchesPerAddr`、`maxSessions` | 分别为 `SP_MAX_CONNECTIONS`、`SP_MAX_CONNECTIONS_PER_ADDR`、`SP_MAX_ROOMS`、`SP_MAX_ROOMS_PER_ADDR`、`SP_MAX_MATCHES_PER_ADDR`、`SP_MAX_SESSIONS` |
| `reconnect` | `soloMs`、`coopMs`、`lobbyMs` | `SP_SOLO_RECONNECT_MS`、`SP_RECONNECT_WINDOW_MS`、`SP_LOBBY_GRACE_MS` |
| `network` | `heartbeatMs`、`helloTimeoutMs`、`resyncMinGapMs` | `SP_HEARTBEAT_MS`、`SP_HELLO_TIMEOUT_MS`、`SP_RESYNC_MIN_GAP_MS` |
| `network` | `ratePerSec`、`rateBurst`、`heavyPerSec`、`heavyBurst`、`abuseDropsPerSec` | `SP_RATE_PER_SEC`、`SP_RATE_BURST`、`SP_HEAVY_PER_SEC`、`SP_HEAVY_BURST`、`SP_ABUSE_DROPS_PER_SEC` |
| `persistence` | `saveMs` | `SP_REDIS_SAVE_MS` |
| `workers` | `simulation`、`rooms`、`matches`、`maxQueue`、`timeoutMs` | `SP_WORKERS`、`SP_ROOM_WORKERS`、`SP_MATCH_WORKERS`、`SP_WORKER_QUEUE`、`SP_WORKER_TIMEOUT_MS` |
| `replays` | `perUser`、`maxBytes` | `SP_REPLAY_LIMIT`、`SP_REPLAY_MAX_BYTES` |
| `shutdown` | `timeoutMs` | `SP_SHUTDOWN_TIMEOUT_MS` |

容量范围为 0–1000000，`maxSessions` 至少 1。每网络容量的 0 表示不限；全局连接／房间的 0 禁止新接入／新建，不代表不限。时间通常为 1 毫秒至 7 天；存档周期至少 1000 毫秒。Worker 数量 0–32，房间 lane 不能超过模拟 Worker 总数；队列 0–10000，Worker 超时 1–3600000 毫秒。退出超时 1000–300000 毫秒，默认 60000；超时退出状态为失败，避免将未完成保存误报为成功。

省略 `workers.simulation` 时保持自动选择线程数。省略 `reconnect.soloMs` 时保持当前分支的单人恢复规则；设为 `null` 可显式跟随游戏数据。部署策略建议明确写入 86400000（24 小时）和 `persistence.saveMs:10000`（10 秒），避免同步上游默认值时改变运营策略。

## 查看生效值

```sh
node tools/server-config.mjs /absolute/path/server.json
```

输出下次启动将采用的 `values` 和各字段的 `sources`（默认、文件、环境变量、显式参数），可以在发布前只读校验；`startServer()` 返回的 `runtimeConfig` 才是该实例启动时实际采用的不可变快照。编辑文件不会更新正在运行的实例。启动日志只报告使用的文件；该工具不输出环境中的凭据。

配置不经公共 HTTP 提供，也不加入浏览器构建或 WebSocket。密码／令牌仍使用 Secrets；HTTP 监听、CDN、Redis 连接、账户路径及插件策略继续沿用原有专用配置。未合入的 pending 接入、满员恢复优待随功能加入注册表，当前写入此类未知键会明确报错。内部批大小、协议常量不作为运营设置暴露。

## 容器和发布

将专用配置**目录**只读挂载到 `/app/server-config`，设置 `SP_SERVER_CONFIG=/app/server-config/server.json`。目录挂载可以识别编辑器原子替换文件的保存方式。普通参数不需要写进镜像；更新后重启游戏容器即可。

本服务的部署配置位于个人配置仓库 `deploy/stronghold-protocol`。发布脚本首次安装其 `server.json` 策略，之后保留服务器配置目录已有内容。候选构建校验配置副本；等待期间若文件变化则要求重新准备候选。Compose 停止宽限至少为生效的退出超时加 30 秒，发布停止容器时尊重该宽限。原有环境变量仍优先，遇到不符预期的值应先检查 `sources`。

验证：`test/server-runtime-config.test.js`、房间／容量、监控、账户／存档和 Match Worker 回归。配置变化本身无需重新构建前端；首次接入配置读取器仍需发布新服务。

回放数量默认每账户 10，固定上限 9；单局原始记录默认 8 MiB。字段范围、降额保护和禁用语义见 [REPLAYS.md](REPLAYS.md)。
