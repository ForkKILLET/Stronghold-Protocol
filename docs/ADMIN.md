# 实时管理面板（本分支）

管理面板使用游戏同一 HTTPS 地址下的 `/admin`，通过独立管理员口令登录。面板是单独的 Node HTTP 服务和容器，不创建游戏身份或游戏 WebSocket；第一版仍为只读。

## 服务边界

- 游戏 `server/admin/telemetry.js` 只在显式配置服务密钥后开启内部监听器，`GET /v1/snapshot` 返回 schema 1 的白名单投影。默认仅监听回环地址；容器部署显式监听内部端口 8001，不发布宿主机端口，不在游戏的公开 HTTP 路由提供采集接口或管理页。
- 面板 `server/admin/service.js` 持有管理员认证、查询、分页和最多五分钟资源趋势，通过固定内部目标采集。请求合并、4 秒超时、不跟随重定向、8 MiB 响应上限；浏览器不能指定采集地址。
- `tools/build-admin.mjs` 将共享主题、Button／Tabs／Select、字体及语言包打包为面板自有 `/admin/assets/` 文件，不依赖运行中的游戏前端或其版本。`deploy/admin/Dockerfile` 最终只复制这些产物和打包后的服务；字体复用现有游戏素材镜像，不下载游戏资源。
- 面板不读取 Redis 检查点、SQLite 或 Docker socket。内部用户 ID 仅用于游戏端账户去重，不输出；不请求 Match snapshot／diag／完整棋盘或背包，不暴露地址、令牌、恢复码、Cookie 或存档。

## 配置

游戏容器需要：

```yaml
environment:
  SP_ADMIN_TOKEN_FILE: /run/secrets/stronghold_admin_token
  SP_ADMIN_HOST: 0.0.0.0
  SP_ADMIN_PORT: "8001"
secrets:
  - stronghold_admin_token
```

面板容器需要：

```yaml
environment:
  HOST: 0.0.0.0
  PORT: "8000"
  SP_ADMIN_GAME_URL: http://stronghold-protocol:8001
  SP_ADMIN_TOKEN_FILE: /run/secrets/stronghold_admin_token
  SP_ADMIN_PASSWORD_FILE: /run/secrets/stronghold_admin_password
secrets:
  - stronghold_admin_token
  - stronghold_admin_password
```

两个服务加入专用内部网络；面板另外加入 Traefik 网络。Traefik 将 `Host` 加 `Path(/admin)`／`PathPrefix(/admin/)` 的高优先级路由交给面板，其余请求仍交给游戏。沿用原域名、TLS 和外部 7999 端口，无需 CORS 或新公网端口。

管理员口令至少 16 个字符、最多 512 字节；内部服务密钥至少 32 个字符、最多 512 字节，应与口令不同。支持 `SP_ADMIN_PASSWORD`／`SP_ADMIN_TOKEN` 环境变量，但推荐只读文件。密钥文件须可由容器内 node 用户读取，不提交到 Git。面板缺少任一密钥或密钥无效时启动失败。游戏未配置服务密钥时不创建采集监听器。游戏不再读取管理员口令。

管理员会话仅在面板内存保存，有效期八小时；HttpOnly／SameSite=Strict Cookie 限于 `/admin`，可信 HTTPS 代理下带 Secure。面板重启或退出登录使会话失效；游戏重启不影响管理员登录。服务密钥轮换需要更新两端，管理员口令变更只需重启面板。凭据均不入日志和浏览器存储。

生产部署脚本及口令位置见个人配置仓库 `deploy/stronghold-protocol/README.md`。首次拆分使用 `deploy.sh --target all`，等待无对局及无排队后冷更新；后续 `deploy.sh --target admin` 只更新面板，`deploy.sh --target game` 只更新游戏。面板单独发布无需等待对局，不修改游戏容器或长期数据。

## 页面与统计口径

| 页面 | 内容 |
| --- | --- |
| 总览 | 按账户去重的在线／断线保留人数、进行中对局、队列队伍及人数、房间／观战人数；游戏 CPU、RSS、主线程堆、事件循环 P99、WS 收发与积压；Worker 和 Redis 对局持久化摘要 |
| 进行中对局 | 同盟密钥或公共匹配标识、模式／难度、阶段、回合、暂停状态、时长及成员连接、LP、淘汰状态 |
| 匹配与房间 | 等待时长、创建者、真人／AI、观战人数及房间状态 |
| 玩家 | 在线与未过期的断线玩家、位置／同盟、断线时长及公开会话编号；按状态筛选 |

- AI 不计在线玩家；同一账户的多个会话不重复计数。公共队列分别展示队伍数和真人数。
- 房间包含等待、排队和正在对局的房间；对局总数按实例去重。
- 对局时长包含准备、等待、暂停及恢复前已流逝时间，不是纯战斗用时。
- CPU 为游戏 Node 进程及其 Worker 线程，100% 表示一个逻辑核心，可超过 100%；RSS 同样包含线程，堆仅为主线程。不是面板进程、整机或 Docker 配额，也不含插件独立进程。事件循环沿用游戏最近十秒窗口。
- 持久化「已启用」只表示配置了 Redis Persister，不能代替连通性探针；SQLite 是另一机制。

每三秒自动刷新；页面隐藏暂停请求。仅在面板请求时采集，无后台游戏采样定时器；面板端合并并发采集并缓存至少 2.5 秒。趋势最多保留五分钟、101 个采样点，面板重启清空；游戏实例变化时开始新的进程资源曲线。

游戏不可用时，面板保留最后一次成功数据及其时间，明确显示过期并自动重试，不能显示为零人或让管理员退出。尚无任何成功数据时显示读取失败。接口 schema 不匹配有单独提示，不接受错误版本覆盖已有数据；恢复后自动刷新。面板自己的 `/healthz`／`/admin/healthz` 只代表面板存活，不代表游戏健康。

## 接口与验证

面板 `/admin/api/` 提供 `POST login`、`POST logout`、`GET session`、`GET overview`、`GET list?kind=matches|rooms|queue|players`。列表支持昵称／密钥搜索、每页五十条与玩家状态筛选。除登录外需管理员 Cookie；保留同源校验、输入大小限制、来源／全局并发及读取限流、不缓存私有响应。登录每来源每分钟八次、全局六十次，单会话每分钟一百二十次。

游戏内部 `/v1/snapshot` 仅接受服务 Bearer 密钥的 GET，不接受浏览器 Origin，也不使用管理员 Cookie；响应不缓存。公开 `/healthz`／`/metrics` 的格式和口径不变。

```sh
node --test test/admin.test.js test/admin-service.test.js test/metrics.test.js
npm run build:admin
SP_E2E=1 node --test test/ui/admin.e2e.test.js
```

浏览器回归覆盖 Chrome／Firefox、登录／退出、真实 Worker 对局、搜索／下拉框、桌面／窄屏、过期数据和游戏离线；截图输出可设 `SP_E2E_OUT`。服务测试另验证独立重启不影响对局、游戏重启不清除管理员会话、请求合并、版本／体积限制及敏感字段隔离。长期监控、整机指标和告警继续使用 [Prometheus／Grafana 方案](../deploy/monitoring/README.md)。
