# 本地前端连接远程服务器

适合在本机修改页面、渲染、声音或资源加载代码，并连接生产或测试服务器复现问题。
手动地址是开发启动配置，不作为玩家设置中的服务器切换器；只改 `SP_WS_URL` 会使档案 API、数据与对局后端分离，也无法满足生产认证的同源要求。

```sh
npm run dev -- --remote https://genshin.asm.ms:7999
# 或配置环境变量；显式 --remote 优先
SP_DEV_REMOTE=https://genshin.asm.ms:7999 npm run dev
# 不使用前端热更新
npm run dev:source -- --remote https://genshin.asm.ms:7999
```

停止后重新运行普通 `npm run dev`（清除可能设置的 `SP_DEV_REMOTE`），即可回到本机服务器。
此参数仅用于 `--source-client` 命令行入口，不修改 `startServer()` 的行为；普通生产启动若误设此配置会报错。
地址须为完整 HTTPS origin，例如 `https://example.org:7999`，不含用户名、密码、路径、查询或片段；只有本机测试目标允许 HTTP。
修改地址后重启开发命令生效，没有运行时任意转发地址或生产配置改动。

## 打开哪个地址、用哪个账户

打开终端打印的 `Local` 地址：`http://127.x.x.x:3000`。每个远程 origin 派生固定且独立的回环主机地址，避免与普通 localhost、生产页面、其他远程目标共用 Cookie、浏览器存储和 Service Worker。
仅换端口无法隔离 Cookie，因此不使用普通 localhost 的另一端口来承载生产身份。
若端口被占用，可使用 `PORT=3002 npm run dev -- --remote https://example.org`；换端口后浏览器本机偏好和会话存储独立，但同一主机上的账户 Cookie 仍会共享。
代理固定监听该回环地址，不使用 `HOST`，不用于局域网或公开转发。

首次打开会通过远程服务器的正常账户流程获得独立测试身份，不会自动复制生产浏览器的登录、会话令牌或恢复码。
窗口标题带 `[REMOTE 服务器地址]`，终端及浏览器控制台也会标出目标。
**这不是只读模式：资料修改、开局、统计及回放操作都会发生在所选远程服务器。** 建议使用独立测试账户，按正常界面流程操作；原有恢复码功能仍是正常账户恢复，会修改真实账户凭据。

已有真实档案的非破坏性调试继续使用 [`profile:pull` 本机副本](USERS.md#使用生产档案的本机副本调试)，不会回写生产数据。

## 本地和远程各负责什么

| 路径／能力 | 来源 |
| --- | --- |
| 首页 HTML、`/js/`、`/css/`、`/vendor/`、`/i18n/`、图标、资源 SW | 本机源码，CSS 热替换、前端 JS／HTML 自动刷新 |
| `/api/`、`/ws`、`/healthz` | 指定的远程服务器，账户与 WS 使用同一身份 |
| `/sim/`、`/shared/`、`/data/`、`/data.js`、内容集及插件／语言包 | 远程，保持对局规则和内容身份一致 |
| `/js/battle/operatorTraits.js` | 远程，匹配服务器数据中的脚本 SHA-256 |
| `/js/asset-cdn.js`、素材、字体、媒体及 ZIP | 远程的清单和 CDN 配置，继续支持本机预载缓存 |
| `/js/ws-config.js` | 开发代理提供的同源 `/ws`，不使用本机或远程的 `SP_WS_URL` |

本模式不启动本机 Lobby、SQLite、Redis、模拟或对局 Worker；`SP_USER_DB` 等本机游戏后端配置不会应用。
远程 `shared` 和模拟模块不接受本机热修改；调试规则、后端或共享协议改动应使用普通本地模式或相应测试服。
前端新增 API／共享模块导出时，远程部署也必须支持该契约，代理不保证不同版本的任意组合可用。
远程部署后的 build 变化仍沿用现有更新检测；热刷新可能触发当前测试会话重连。

## 代理边界及验证

开发入口先校验本机 Host、Origin 和 Fetch Metadata，再为固定远程目标转发 HTTP／WS，并保持 TLS 证书验证。
仅转发游戏账户 Cookie，不转发管理员 Cookie、Authorization 或客户端伪造的来源 IP；响应中的账户 Cookie 改为回环主机专用 Cookie。
生产服务原有的 Cookie／Origin 检查保持不变；管理面板、内部管理接口、工作台和 metrics 不在代理入口中。
远程失败返回 502，不创建本地游戏、不回落到另一后端；同目标跳转改写为本机地址，跨目标跳转拒绝。
请求和响应流式转发，WebSocket 保留二进制、压缩与关闭帧；停用开发服务时释放连接及热更新监听。

定向测试见 `test/dev-remote.test.js`，包含真实本机后端的 HTTP／WS 账户一致性及 Firefox 的回环安全上下文、Cookie、存储和热更新检查。
按 [本机内存隔离规则](LOCAL_TESTING.md) 顺序执行：

```sh
npm run check:local -- --small node --test --test-concurrency=1 test/dev-remote.test.js test/dev-reload.test.js test/dev-user-storage.test.js
SP_E2E=1 npm run check:local -- --small node --test --test-concurrency=1 test/dev-remote.test.js
```
