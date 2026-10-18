# 实时管理面板（本分支）

访问游戏同一 HTTPS 地址下的 `/admin`，使用**独立管理员口令**登录。第一版只读，未提供踢人、暂停、删房间或其他管理写操作。无需额外端口、数据库或监控容器，管理页不会创建游戏身份、连接游戏 WebSocket 或增加在线人数。

## 启用

默认关闭，未配置时 `/admin` 及其 API 均返回 404。推荐用文件注入口令：

```yaml
services:
  stronghold-protocol:
    environment:
      SP_ADMIN_PASSWORD_FILE: /run/secrets/stronghold_admin_password
    secrets:
      - stronghold_admin_password
secrets:
  stronghold_admin_password:
    file: ./secrets/stronghold_admin_password
```

将上面的字段合并进现有游戏服务；保留其 Traefik、数据卷及其他配置。密钥文件须能被容器内的 `node` 用户读取，不要提交到 Git。口令至少 16 个字符，最多 512 字节，文件允许末尾一个换行。可改用 `SP_ADMIN_PASSWORD`，两者同时设置时以文件为准。无效口令或无法读取的文件使启动失败，避免误以为已启用保护。

既有 Traefik host + TLS 路由即可覆盖 `/admin`，无需添加路由或端口。代理应保留原始 Host，并正确设置 `X-Forwarded-Proto: https`；服务按现有 `TRUST_PROXY` 规则信任代理。公网继续使用 HTTPS。

登录有效期为 8 小时，Cookie 限于 `/admin`，采用 HttpOnly / SameSite=Strict，HTTPS 下附加 Secure。会话仅在内存中保留，服务器重启或退出登录后失效；更换口令后重启生效。不保存浏览器口令、明文会话令牌或管理历史。

## 页面与统计口径

| 页面 | 内容 |
| --- | --- |
| 总览 | 在线／断线保留人数、进行中对局、队列人数及队伍数、房间数、观战人数；CPU、RSS、主线程堆、事件循环 P99、WS 收发与积压；Worker 和 Redis 对局持久化摘要 |
| 进行中对局 | 同盟密钥或公共匹配标识、模式／难度、阶段、回合、暂停状态、时长，展开成员查看连接、LP、淘汰状态 |
| 匹配与房间 | 队列与所有房间两个页签，查看等待时长、创建者、成员／AI、观战人数及房间状态 |
| 玩家 | 按账户去重的在线与断线保留玩家，位置／同盟、断线时长及公开会话编号；可按状态筛选 |

- 在线人数按长期账户去重，无长期账户时按公开玩家编号去重。AI 不算在线玩家；未过期的断线会话单独统计。同一账户多个会话可在详情看到数量。
- 房间包含等待、排队和正在对局的房间。对局同时可能出现在房间列表和对局列表，但对局总数按实例去重。公共队列分别展示队伍数和真人数，不把一个队伍当作一名玩家。
- 对局时长从创建对局起算，包含战前准备、等待和暂停，恢复后保留已流逝时长；不是纯战斗用时。房间／队列分别展示创建至今／等待时长。
- CPU 是游戏 Node 进程及其 Worker 线程，100% 表示占满一个逻辑核心，可超过 100%。RSS 同样包括进程内线程，堆内存仅为主线程；不代表整机或 Docker 配额，也不包含独立插件进程。事件循环沿用独立的最近 10 秒窗口，启动未积累时显示 `—`。
- 持久化「已启用」只表示已配置 Redis Persister；结合累计失败数、检查点及待恢复／待结算数判断状态，不把这个标记当作 Redis 连通性探针。SQLite 用户存储仍是独立机制。

每 3 秒自动刷新，可手动刷新；隐藏页面暂停请求，返回立即更新。资源图保留最多 5 分钟、101 个点，仅在面板有人访问时采样，无访问 1 分钟后停止。采样点不足显示提示；重启清空。请求失败保留最近数据并标记，自动重试；登录过期清除页面内管理数据。

列表支持昵称／同盟密钥搜索，每页 50 条。成员信息来自已有广播的轻量投影；不请求完整 Match 快照、棋盘、背包或 Worker 检查点。API 只输出显式允许的字段，排除账号内部 ID、重连令牌、Cookie、地址、恢复码和存档内容。原有公开 `/healthz`、`/metrics` 的响应格式保持不变。

## 接口与验证

接口都在 `/admin/api/` 下：`POST login`、`POST logout`、`GET session`、`GET overview`、`GET list?kind=matches|rooms|queue|players`。`list` 接受 `page`、`q`，玩家列表另接受 `status`。除登录外均需管理员 Cookie；同源校验、请求大小、登录来源／全局并发及读取限流均在服务器端执行，响应不缓存。登录限每来源每分钟 8 次、全局每分钟 60 次，单个会话读取每分钟 120 次。

```sh
node --test test/admin.test.js test/metrics.test.js test/room-controls-worker.test.js test/match-worker-lifecycle.test.js
SP_E2E=1 node --test test/ui/admin.e2e.test.js
```

浏览器回归覆盖 Chrome／Firefox、登录失败／退出、真实对局与队列、搜索／自定义下拉框、窄屏、刷新失败恢复和页面隐藏暂停。截图默认输出 `/tmp/stronghold-admin-shots`，可设置 `SP_E2E_OUT`。需要长期趋势、告警或整机监控时，继续使用 [现有 Prometheus／Grafana 方案](../deploy/monitoring/README.md)。
