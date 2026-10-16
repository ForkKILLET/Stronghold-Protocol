# 部署指南

目标：在一台家用 Windows 小主机上长期开服，让朋友通过局域网或公网来玩。macOS / Linux / Docker 放在后面。
所有命令都在项目根目录执行。遇到问题先运行 `node tools/doctor.mjs`（只读诊断）。

## 0. 资源需求

| 项目 | 说明 |
|---|---|
| 服务器 CPU | 战斗在各玩家浏览器里模拟（DESIGN §14），服务器只负责回合、经济和校验：**每个房间每个作战回合约 1 ms CPU**。AI 队友 / 掉线玩家的战场由服务器模拟：作战开始时 3 个 AI 战场在开发机上约 0.2–0.5 s CPU，小主机上可能要几秒（分成 8 ms 小片执行，不会卡住其他房间）。`SP_VERIFY=all` 会复算每个真人战场，CPU 明显增加，小主机建议保持 `off` 或 `sample`。AI 布阵的试算也会消耗 CPU；原版房间可设 `SP_BOT_REHEARSAL=host`，让房主浏览器代算（见下面）。 |
| 服务器内存 | 空闲约 100 MB，每个进行中的对局再增加几 MB。 |
| 网络 | 4 人对局中服务器每回合下行约 0.25 MB（DESIGN §14 实测；0.2.6 起 1 KB 以上的 WebSocket 消息用 permessage-deflate 压缩，实测一局单人对局的服务器消息从 173 KB 降到 60 KB，约为原来的三分之一）。首次进入游戏时浏览器要从主机下载所需的图片 / Spine 模型 / 音频（按需加载，之后走浏览器缓存），公网隧道带宽小时第一次会慢一些。0.2.6 起服务器启动后在后台给素材算内容哈希（第一次约 1–20 秒，看机器和硬盘；之后只检查大小和修改时间），下发的素材清单里每个地址带上哈希：浏览器把图片、模型和音频缓存一年，服务器更新、重新解压或 Docker 重建之后，玩家只重新下载内容真的变了的文件。哈希存在 `.cache/asset-hashes.json`，删掉会重新计算；目录不可写（例如只读的容器）时只在内存里算。 |
| 磁盘 | 素材约 720 MB（`public/assets`，含中文约 65 MB、日文约 85 MB、英文约 71 MB、韩文约 80 MB、本土语言约 18 MB 的干员语音）+ 依赖约 125 MB（`node_modules`；整合包只带运行依赖，约 65 MB）；可选的本地提取约 40 MB（`.venv-extract`）+ 约 330 MB（贴图、各战场官方场景和官方战斗特效，见第 6 节）。完整包解压后约 1.16 GB。 |
| 玩家设备 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑或手机平板（横屏）。老旧设备可在设置里调低画质或访问 `/?board=2d`。 |

房间和对局只存在内存里，没有数据库和对局存档。重启服务器会结束正在进行的对局（包括断线后本可在 24 小时内回来继续的独立模拟）。自己安装或制作的插件、`plugins/config.json` 和工作台钥匙保存在磁盘上，请按需备份 `plugins/`。

**房主帮 AI 试算布阵（可选）：**环境变量 `SP_BOT_REHEARSAL` 不设或设为 `server` 时，AI 布阵试算仍在服务器上（默认）。设为 `host` 后，当前房主的浏览器在整备阶段用同源的模块 Worker（`/js/battle/rehearsalWorker.js`，不绘图、不用 `eval`）比较 AI 队友的几种布阵，只把选中的序号发回；服务器直接采用，不再重算。房主掉线、换人、报错、答案不合法或超时（默认 3 秒）时，服务器用同一批候选自己算。整备先结束则取消试算、保留默认布阵，不延长回合。正式战斗和真人「AI 托管」不受影响。开了玩法插件的房间不走这条路：对局在内容组合自己的进程里，仍由服务器试算，避免浏览器用错数据包或绕过脚本额度。没有可用房主时也不会减少服务器负担。浏览器会多算一些，耗时取决于房主设备和局面。这个接口（任务、答案序号、超时、回退到服务器）以后可以换成本机或外部计算，当前版本不会对外发起网络请求。

## 1. Windows 小主机：一步步

### 1.1 安装与首次启动

1. 安装 Node.js 22 LTS 和 Git（在 PowerShell 或「终端」里；用下面的整合包时不需要 Git）：
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   装完**关闭并重新打开**终端，`node -v` 应显示 v22 或更高（winget 的 LTS 目前是 v24.x，同样可用）。没有 winget 时从 <https://nodejs.org/zh-cn/download> 和 <https://git-scm.com/download/win> 下载安装。
2. 下载，三选一。建议放在一个固定、短、**不在 OneDrive 同步范围内**的目录，例如 `C:\Stronghold-Protocol`：
   - **完整包（推荐）**：在仓库的 [Releases](https://github.com/sganggs/Stronghold-Protocol/releases) 页面下载最新版本的 `Stronghold-Protocol-v<版本>.zip`（约 800 MB，解压后约 1.16 GB；已含运行依赖、前端库和全部素材，包括中文、日文、英文、韩文和本土语言的干员语音和官方 3D 棋盘、各战场官方场景、官方战斗特效等本地客户端素材），解压后把里面的 `Stronghold-Protocol` 文件夹放到上述位置。不需要 Git，首次启动也不用再下载素材。素材版权归上海鹰角网络 / Yostar，仅限非商业使用，见 [NOTICE.md](../NOTICE.md)。
   - **精简包**：同一页面的 `Stronghold-Protocol-v<版本>-lite.zip`（约 25 MB）。代码、运行依赖和前端库与完整包相同，但不带素材：美术、Spine 模型、音频（含全部干员语音）、字体、表情和「玩法说明」教程图在首次启动时由 setup 从公开镜像下载（约 720 MB，显示进度，可中断续传；镜像设置见下面的「国内镜像下载」）。官方 3D 棋盘等本地客户端素材需要用本机客户端提取，或从同一版本的完整包复制（第 6 节）。适合下载大文件不方便、或想先下一个小包的情况；放置方式同完整包。
   - **源码**：
     ```powershell
     git clone https://github.com/sganggs/Stronghold-Protocol.git C:\Stronghold-Protocol
     ```
3. 双击 `C:\Stronghold-Protocol\scripts\start-windows.bat`。首次会：安装依赖（`npm ci`；整合包已含，跳过）→ 复制前端库（整合包已含，跳过）→ 下载约 550 MB 素材（完整包已含，跳过；精简包和源码在这一步下载，显示进度，中断后再次启动会续传）→ 若检测到本机的明日方舟客户端，询问是否提取官方贴图（可跳过）→ 启动服务器并打开浏览器。
4. 窗口里会打印朋友可用的地址，例如 `http://192.168.1.23:3000`。用另一台设备打开它确认能进入。关闭窗口即停止服务器。

等价的手动命令：`npm ci`、`node tools/setup.mjs`、`npm start`。

### 前端构建与缓存

从源码生产部署时运行：

```bash
npm ci
npm run build
npm start
```

`npm run build` 先准备前端库，再由 Vite 将页面 JS/CSS 打包到 `public/build/`。服务器在该目录有 `index.html` 时自动使用构建页面；HTML 保持 `no-cache`，`/build/assets/` 下带内容哈希的 JS/CSS 使用 `public, max-age=31536000, immutable`，并继续支持 gzip 与 ETag。基础 UI 库独立分包，渲染器、战斗模拟和 Three.js 按需加载。素材、字体、游戏 JSON、素材预载 Service Worker 仍通过现有路由提供；`SP_ASSETS_CDN` 和 `SP_DATA_CDN` 仍可在启动时配置，无需为不同 CDN 重新构建。

`setup` 在安装了 Vite 时自动构建；Docker 构建和 Windows 便携包制作也包含前端构建，运行容器/便携包无需安装 Vite。仅安装生产依赖（`npm ci --omit=dev`）时，应先在构建机器上生成 `public/build/` 并一同部署。

开发时使用 `npm run dev`，会强制提供源码页面，刷新浏览器即可看到修改。没有构建产物时普通启动也会回退到源码页面。每次生产更新都需要重新构建并重启服务，已有构建不会自动跟随源码变化。

构建不会删除旧哈希文件，以便已经打开的页面继续加载旧版分包。在线更新时先上传新增的 `build/assets/` 文件，再替换 `build/index.html`，保留旧分包；定期清理请在维护停服期间进行。不要直接删除整个 `public/build/` 后在线重建。

#### 国内镜像下载

Setup 默认使用「GitHub 原始源 → jsDelivr」，不查询公网 IP，也不请求 gh-proxy.com。GitHub 下载失败时会提示如何手动开启镜像；仅添加提示，不自动切换到第三方代理。

镜像方法是在完整 GitHub 链接前加 `https://gh-proxy.com/`，例如：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/OWNER/REPO/BRANCH/file.png
```

手动开启后顺序为「前缀镜像 → 原始源 → jsDelivr」。索引、图片、Spine、音频和字体都使用此规则（音频 voice 分支跳过 jsDelivr）。镜像是第三方代理；当前只校验格式和大小，没有内容哈希校验，请自行决定是否信任并启用。npm / pip 依赖不使用 GitHub 前缀。

```powershell
node tools/setup.mjs --asset-source=mirror  # 手动优先国内镜像
node tools/setup.mjs --asset-source=direct  # 默认：仅原始源和 jsDelivr，不使用前缀代理
$env:SP_ASSET_SOURCE = 'mirror'             # 也可用环境变量显式启用
```

`node tools/fetch-assets.mjs` 同样支持 `--asset-source=direct|mirror`。命令行优先于 `SP_ASSET_SOURCE`。默认镜像前缀为 `https://gh-proxy.com/`，可通过 `SP_GITHUB_PROXY` 指定其他 HTTPS 前缀；仅配置前缀不会启用镜像。将 `SP_GITHUB_PROXY` 设为空字符串（或全空格）可彻底禁用前缀代理，即使选择了 `mirror` 模式；未设置此变量与显式设空不同，前者使用默认前缀。Windows PowerShell 的某些版本会将空值视为删除变量，可设置 `$env:SP_GITHUB_PROXY = ' '` 或使用 `--asset-source=direct` 来明确禁用。前缀只处理 GitHub 下载链接，不重复添加。

镜像请求每个 URL 只尝试一次，响应头超时 8 秒，响应体有独立的空闲超时，失败即尝试原始源。连续 3 次网络错误、HTTP 错误或无效内容会在本次运行中关闭镜像，后续索引、素材和字体共享该状态；正在进行的镜像请求也会中止并回退。成功会清零连续失败次数；404 / 410 是资源不存在，不触发熔断。再次运行脚本会重新尝试手动启用的镜像。原始源的重试、已有文件跳过和 0.1.1 的清单缩减保护保持不变。

从历史下载记录派生的 Spine 补充贴图也按本次设置重新选择来源，禁用后不会沿用旧代理地址。

### 1.2 防火墙

- 第一次启动时 Windows 会弹出「Windows 安全中心警报」：勾选**专用网络**并点「允许访问」。
- 没弹窗或点错了，用**管理员** PowerShell 添加规则（下面的开机自启脚本也会自动添加）：
  ```powershell
  netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
  ```
- 家里的网络要是「公用网络」，Windows 会拦截入站连接。改成专用（管理员 PowerShell；网卡名用 `Get-NetConnectionProfile` 查看）：
  ```powershell
  Set-NetConnectionProfile -InterfaceAlias "以太网" -NetworkCategory Private
  ```
- `node tools/doctor.mjs` 会显示规则是否存在、每个网络的类型，以及朋友可用的地址。

### 1.3 固定局域网 IP（推荐）

主机 IP 变了，朋友收藏的地址就失效。推荐在**路由器**后台的「DHCP 静态分配 / 地址保留」里把小主机的 MAC 地址绑定到固定 IP（如 `192.168.1.50`）。也可以在 Windows「设置 → 网络和 Internet → 属性 → IP 分配 → 编辑」里手动设置（IP、子网掩码、网关、DNS 与路由器一致，且不要与别的设备冲突）。

### 1.4 开机自动在后台运行

先关闭 `start-windows.bat` 的窗口（否则端口冲突），然后在项目目录运行（会自动请求管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1
```

它会：运行一次 `tools/setup.mjs` → 把设置写入 `scripts\service.env.cmd`（node.exe 路径、端口等）→ 注册计划任务 **StrongholdProtocol**（开机 20 秒后以 SYSTEM 身份运行 `scripts\run-server.cmd`，无需登录；服务器退出后 5 秒自动重启）→ 添加防火墙规则 → 立即启动并显示状态。日志在 `logs\server.log`（超过 10 MB 自动轮换）。

| 需求 | 命令（都加在 `powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1` 之后） |
|---|---|
| 换端口 / 其他设置 | `-Port 8080`、`-Verify sample`、`-Combat server`、`-BindHost 127.0.0.1`（只给反向代理用） |
| 公用网络也放行 | `-AllowPublicNetwork`（一般不需要；Tailscale 网卡被识别为公用网络时可能需要） |
| 查看状态和最近日志 | `-Status` |
| 重启（更新代码后） | `-Restart` |
| 停止 | `-Stop`（下次开机仍会自动启动） |
| 卸载 | `-Uninstall`（删除计划任务、防火墙规则和 `service.env.cmd`） |

建议同时关闭睡眠，否则小主机会在无人操作时休眠：`powercfg /change standby-timeout-ac 0`。

<details>
<summary>替代方案：用 NSSM 注册成真正的 Windows 服务</summary>

```powershell
winget install NSSM.NSSM            # 或从 https://nssm.cc 下载
nssm install StrongholdProtocol "C:\Program Files\nodejs\node.exe" server\index.js
nssm set StrongholdProtocol AppDirectory C:\Stronghold-Protocol
nssm set StrongholdProtocol AppEnvironmentExtra PORT=3000 HOST=::
nssm set StrongholdProtocol AppStdout C:\Stronghold-Protocol\logs\server.log
nssm set StrongholdProtocol AppStderr C:\Stronghold-Protocol\logs\server.log
nssm start StrongholdProtocol
```

防火墙规则仍需按 1.2 手动添加。两种方式只选一种。
</details>

### 1.5 更新

```powershell
cd C:\Stronghold-Protocol
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Stop   # 装了开机自启时
git checkout -- data/assets.json    # 素材清单由 setup 重新生成，先还原以免 git pull 冲突
git pull
npm ci
node tools/setup.mjs                # 补下载新增的素材（已有文件会跳过）
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Restart
```

没装开机自启的话，最后一步改成重新双击 `start-windows.bat`。

#### 用整合包安装的：更新包

0.2.1 起，Releases 里每个版本除了完整包和精简包，还有更新包 `Stronghold-Protocol-v<版本>-update.zip`：只含比说明中列出的旧版本改动过的文件（程序、数据、运行依赖，以及改动过的素材），通常只有几 MB。它用来升级用 0.2.0 及以后的完整包或精简包装好的文件夹（适用的版本写在 Releases 说明里）；全新安装、0.1.x 和 GitHub「Download ZIP」源码包请用完整包或精简包，`git clone` 的用上面的 `git pull`。

```powershell
cd C:\Stronghold-Protocol
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Stop   # 装了开机自启时；没装就关掉服务器窗口
Expand-Archive -Force <下载目录>\Stronghold-Protocol-v<版本>-update.zip C:\       # 解压到安装文件夹的上一层，合并进 C:\Stronghold-Protocol、覆盖同名文件
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Restart
```

没装开机自启的，最后一步改成双击 `start-windows.bat`。也可以在资源管理器里打开 zip，把其中 `Stronghold-Protocol` 文件夹的全部内容复制到安装文件夹，选「替换目标中的文件」。macOS / Linux：停止服务器后运行 `unzip -o Stronghold-Protocol-v<版本>-update.zip -d <安装文件夹的上一层>`（安装文件夹名为 `Stronghold-Protocol`）；不要用访达拖放，它会把同名文件夹整个替换掉。

启动时（双击启动、`npm start`、开机自启的计划任务、NSSM / systemd 都一样）服务器先完成更新：按 `MANIFEST.json` 核对全部程序文件（代码、数据、运行依赖、前端库和说明文档；素材归 setup 管，不在其中），删除 `UPDATE.json` 列出的、新版本不再使用的旧文件（只删内容与旧版本发布时完全一样的文件：自己改过的文件、自己装的内容包、`logs`、`.cache` 都不会动），再把 `UPDATE.json` 改名为 `.update-applied.json`，然后照常启动，日志里有一行「已更新到 v<版本>」。

- **文件夹不是更新包对应的版本**（例如 0.1.x、只解压了一部分、程序文件被改过）：服务器**不启动**，提示「这个更新包只能覆盖在 v0.2.0 … 的整合包安装上（检测到 N 个文件与 v<版本> 不一致或缺失）」并举出几个文件（开机自启的，`-Status` 显示的日志里能看到）。新旧文件混在一起运行，容易出现看起来像游戏 bug 的错误，所以宁可不启动。下载完整包重新安装，或把更新包重新完整解压一遍再启动（`UPDATE.json` 还在，会重新检查；在此之前什么都不删）。
- 只有说明文档、`scripts\`、`tools\` 里的文件不一致：照常启动，日志里列出是哪些文件。`UPDATE.json` 损坏：跳过并提示，按现有文件启动。
- **精简包装的也能用**：程序部分与完整包完全相同；更新包带着完整包里改动过的素材，其余素材仍由 setup 补齐。如果更新包带来了新的本地客户端素材清单（`data/local-assets.json`）而这台电脑没有对应的素材，启动时会提示：从同一版本的完整包复制 `public/assets/local/`（第 6 节），或运行 `node tools/setup.mjs --local` 提取，不需要时删掉 `data/local-assets.json` 即可。
- 更新包不联网、不会自动更新，和完整包一样从 Releases 手动下载。`npm run doctor` 的「文件校验 MANIFEST.json」一行随时显示全部程序文件是否与这个版本一致（源码目录没有这个文件，不做校验）。

不用更新包也可以：停止服务器，把新版本的整合包解压到新目录后从那里启动（完整包已含素材；装了开机自启的，在新目录重新运行一次 `install-service-windows.ps1`）。用精简包或 GitHub「Download ZIP」源码包的：解压新版本后，把旧目录里的 `public\assets`、`public\fonts`、`.cache` 和 `data\local-assets.json`（若有）复制过去，可避免重新下载（setup 只补下新增的素材）。

## 2. 让不在同一网络的朋友加入

### Docker Compose 自动部署与回滚

仓库提供 `scripts/deploy-compose.mjs`，适配游戏服务名为 `stronghold`、Redis 服务名为
`redis` 的 Compose。它不会假设仓库中存在游戏 Compose 文件，使用服务器上的实际文件：

```bash
node scripts/deploy-compose.mjs \
  --compose /srv/stronghold/docker-compose.yml \
  --static-root /opt/1panel/www/sites/wei.linxia.dev/index
```

默认是 dry-run，只做 Compose 配置检查并列出同步计划。实际部署：

```bash
node scripts/deploy-compose.mjs \
  --compose /srv/stronghold/docker-compose.yml \
  --static-root /opt/1panel/www/sites/wei.linxia.dev/index \
  --apply
```

如果希望部署脚本同时自动补齐素材并生成 16MB 分类资源包（不转换图片/音频）：

```bash
node scripts/deploy-compose.mjs \
  --compose /srv/stronghold/docker-compose.yml \
  --static-root /opt/1panel/www/sites/wei.linxia.dev/index \
  --asset-source direct \
  --prepare-assets \
  --apply
```

`--prepare-assets` 会先运行 `tools/setup.mjs --yes --no-local --no-scenes` 下载/续传公开
素材，再在部署备份目录创建素材副本作为隔离候选、重算
`asset-hashes.json`、生成运行时资源清单和不超过 16,000,000 bytes 的分类 ZIP。
所有步骤成功后才发布候选清单和分包，并同步静态 CDN；素材下载/续传沿用 setup，
不做图片/音频转换，也不覆盖已有原件为新编码。Python 默认使用 Linux 的 `python3`、
Windows 的 `python`，分包仅需 Python 标准库，可用 `--python /path/to/python` 指定环境。

脚本执行顺序：

1. `docker compose config --quiet` 校验 Compose；
2. 记录旧游戏容器镜像并备份 Compose、公告、关键 data 清单；
3. 同步 `data` 到 `srv`、`public/assets` 到 `assets`、字体到 `fonts`，可选同步
   `public/resource-packs` 到 `resource-packs`；
4. `docker compose build --pull stronghold`；
5. 只启动/重建 `stronghold`，Redis 仅确保启动和健康，不删除卷；
6. 轮询 `http://127.0.0.1:3080/healthz`；
7. 健康检查失败时，将旧镜像重新标记并执行 `up --no-build` 回滚，失败日志和备份目录保留。

可用参数：

- `--pull`：部署前执行 `git pull --ff-only`；
- `--no-build`：跳过镜像构建；
- `--skip-data`、`--skip-assets`、`--skip-packs`：跳过对应同步；
- `--data-target`、`--assets-target`、`--fonts-target`、`--packs-target`：分别指定目标目录；
- `--health URL`、`--wait 180`：修改健康检查地址和超时；
- `--backup-root DIR`：修改备份目录。

脚本不会执行 `docker compose down -v`，不会覆盖 `config/announcements.json`，不会刷新或删除
Redis 数据卷。你的 Compose 中 `./public/assets:/app/public/assets:ro` 和 `./config:/app/config:ro`
会覆盖镜像内对应目录，因此必须同步正确的宿主机素材和公告目录；脚本只同步 CDN 静态目录，
不会擅自修改这些挂载源。

资源分包发布见 [预载资源传输分包](RESOURCE_PACKS.md)；主分支不再包含通用 assets shrink 转换工具。
升级前不要移动线上 PNG/atlas 或原二进制；新客户端与新素材先发布，再切换匹配的三个素材
清单。Node 支持资源同目录的预压缩 `.br/.gz`，但保留原件用于 identity/Range/指纹。
这不替代实际 Nginx/CDN 配置和验证，也不要求玩家清空所有旧缓存。

### 2.1 Tailscale / ZeroTier（推荐给家用小主机）

组一个虚拟局域网：不需要公网 IP、不需要改路由器、不暴露到互联网。

- **Tailscale**：主机和朋友都安装 <https://tailscale.com/download>（Windows：`winget install Tailscale.Tailscale`）并登录。朋友用自己的账号时，在 Tailscale 管理后台把这台主机「Share」给他们，或邀请他们加入你的 tailnet。朋友访问 `http://<主机的 100.x.y.z 地址>:3000`（`tailscale ip -4` 查看；开了 MagicDNS 也可以用 `http://<主机名>:3000`）。
- **ZeroTier**：在 <https://my.zerotier.com> 创建网络，主机和朋友安装客户端并加入同一个 Network ID，在后台勾选授权成员；访问 `http://<主机的 ZeroTier IP>:3000`。
- 连不上时运行 `node tools/doctor.mjs`：看 VPN 网卡是否被 Windows 识别为「公用网络」，是的话按 1.2 改为专用，或安装自启时加 `-AllowPublicNetwork`。

### 2.2 cloudflared 临时隧道（朋友什么都不用装）

```powershell
winget install --id Cloudflare.cloudflared      # macOS: brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

把输出的 `https://xxxx.trycloudflare.com` 发给朋友。页面是 https 时客户端自动改用 `wss://`，不需要任何配置；服务器会通过隧道转发的 `CF-Connecting-IP` 识别真实来源（`TRUST_PROXY=auto`）。临时隧道每次启动地址都不同，且没有可用性保证；需要固定地址请使用 Cloudflare 账号 + 自己域名的「命名隧道」。

**固定访问地址能省很多流量**：浏览器的缓存、设置、统计和断线令牌都按地址（域名或 IP + 端口）分开保存。地址一换，对玩家来说就是一个新网站：每个人进游戏都要把图片、模型和音频重新下载一遍（第一局约 20–50 MB），设置和本机统计也看不到了。临时隧道每次重启都换域名，所以固定朋友圈子长期开服时，建议用命名隧道、Tailscale（2.1）或固定的公网 IP / 局域网 IP（1.3），让大家一直用同一个地址。

### 2.3 路由器端口转发

仅当你有**公网 IPv4**（很多宽带是运营商级 NAT，没有公网 IP，此时请用 2.1 / 2.2）：

1. 先按 1.3 固定主机的局域网 IP。
2. 路由器「虚拟服务器 / 端口转发」：外部端口 3000（或任意端口）→ 内部 `主机IP:3000`，TCP。
3. 朋友访问 `http://<你的公网 IP>:外部端口`。

注意：游戏没有账号系统，知道地址的人都能进来。服务器对来自互联网的连接有按网络的数量限制（每个网络最多 64 个连接，房间 / 对局数量也有上限），但仍建议不玩时关掉转发，或优先用 Tailscale。

### 2.4 反向代理与 HTTPS（有域名时）

必须部署在**域名根路径**（客户端使用 `/data/`、`/vendor/`、`/ws` 等绝对路径，不支持挂在子路径下）。代理需要转发 WebSocket 升级（路径 `/ws`）。建议让服务器只监听本机：`HOST=127.0.0.1`（Windows 自启：`-BindHost 127.0.0.1`）。

**Caddy**（自动申请 HTTPS 证书，WebSocket 无需额外配置）：

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx**：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 443 ssl http2;   # 新版 Nginx（1.25.1 起）写成 listen 443 ssl; 加一行 http2 on;
    server_name game.example.com;
    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;      # WebSocket 长连接
    }
}
```

**HTTP/2**：客户端由数百个小脚本模块组成（0.2.0 起进入对局时约 340 个），隔着公网时建议让代理以 HTTP/2 提供页面：所有模块走同一条连接，远距离玩家首次进入对局明显更快。Caddy 默认就是 HTTP/2；Nginx 见上面的 `http2`。服务器本身只说 HTTP/1.1，局域网或本机游玩不受影响。HTTP/2 省的是往返等待，不减少字节数。

**压缩**：服务器自己压缩脚本、样式、数据和 Spine 的 `.skel` / `.atlas`：浏览器支持 brotli 时用 brotli（0.2.6 起，质量 5，比 gzip 快且更小：实测 `.skel` 小约 27%、游戏数据 JSON 小约 26%、前端库小约 14%、脚本小约 5%），否则用 gzip；图片和音频本来就是压缩格式，原样发送。浏览器只在 HTTPS 页面（以及 `localhost`）上声明支持 brotli，所以通过代理或隧道的 https 地址访问时用 brotli，局域网里的 `http://192.168.x.x:3000` 这类地址用 gzip。代理不需要另开压缩（Caddy 的 `encode`、Nginx 的 `gzip` 遇到已经压缩的响应会跳过）。

**Cloudflare 缓存**（命名隧道或自己的域名经过 Cloudflare 时）：Cloudflare 默认只缓存常见扩展名，`.skel`、`.atlas` 和没有扩展名的音频地址 `/media/…` 都不在其中，每个请求都会回到开服的电脑。在 Cloudflare 控制台的「缓存规则」里加一条：主机名是你的游戏域名、且 URI 路径以 `/assets/`、`/fonts/` 或 `/media/` 开头时「符合缓存条件」，边缘 TTL 选「使用源站的 Cache-Control」。本分支普通素材保持源站的一天缓存策略；更新同路径素材时同步清单与指纹并刷新 CDN，不将普通素材强制缓存一年；`/data/`、页面和脚本不要加进规则（它们要随服务器更新）。注意：边缘公开缓存官方素材会增加被投诉的风险，大量媒体文件也要留意 Cloudflare 的服务条款；只给自己人玩时不加这条规则也可以。

https / wss 说明：页面通过 https 打开时客户端自动连接 `wss://同一域名/ws`；http 时用 `ws://`。服务器本身只提供 http，证书由代理 / 隧道负责。代理与服务器在同一台机器或内网时，`TRUST_PROXY=auto` 会信任它的 `X-Forwarded-For` / `X-Real-IP`；代理在公网另一台机器上时设 `TRUST_PROXY=1`（同时确保游戏端口只对代理开放）。

### 2.5 本分支素材管理

标题页统一使用本分支预载资源面板；不提供上游“下载完整素材”、“导入素材包”或 `tools/package.mjs --assets`。
已有资源管理窗口的 ZIP 导入/导出、分包预载、缓存指纹和多线路下载继续有效，详见 [RESOURCE_PACKS.md](RESOURCE_PACKS.md)。

## 3. Docker

```bash
# A) 构建时下载素材（需要联网，约 720 MB）
docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped stronghold-protocol

# B) 不把素材打进镜像：先在宿主机运行 node tools/setup.mjs，然后挂载
docker build -t stronghold-protocol .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
```

镜像从源码（`git clone`）构建，Releases 的整合包不含 `Dockerfile`。镜像基于 `node:22-alpine`，多阶段构建，只含生产依赖（包括 `ses@2.3.0` 和 `acorn@8.18.0`）；`public/vendor`（含 `ses.umd.js` / `acorn.mjs`）在构建时生成。`node_modules` 是镜像安装目录里的实际文件，不是指向镜像外的符号链接，脚本沙箱子进程可以在 `--allow-fs-read` 范围内读取。`.dockerignore` 排除了 `public/assets`（不会把宿主机素材打进构建上下文）；`public/fonts`、`data/assets.json` 和 `data/local-assets.json` 若存在会被复制进去。环境变量同 README（`-e SP_VERIFY=sample` 等）。健康检查：`GET /healthz`。

**持久化插件**：把命名卷或宿主机目录挂到 `/app/plugins`，例如加 `-v stronghold-plugins:/app/plugins`。
镜像在 `/app/plugin-resources` 保留只读的 `_template/`、`README.md` 和 `AGENTS.md`，用
`SP_PLUGIN_RESOURCES=/app/plugin-resources` 让工作台读取模板；不要把卷挂到这个资源目录。
即使 `/app/plugins` 是空的，界面和脚本模板仍可用。CLI、Schemas、作者文档和测试助手也在镜像里。
命名卷首次使用继承目录的 `node` 用户权限；宿主机绑定目录须允许容器里的 `node` 用户写入（工作台钥匙和草稿也写在这里）。
镜像不会复制构建机器自己的插件、插件打包产物或备份。

脚本模式用 `-e SP_PLUGIN_SCRIPTS=sandbox` 显式开启；默认仍关闭。容器默认监听 `0.0.0.0`，
原生受信任执行因此必须选择 `trusted-force` 并按第 10 节审查与固定哈希。需要工作台时从本机或局域网地址访问。

Docker Compose 示例（插件命名卷与只读模板分开；脚本默认关闭）：

```yaml
services:
  stronghold:
    build:
      context: .
      args: { FETCH_ASSETS: "1" }
    ports: ["3000:3000"]
    restart: unless-stopped
    environment:
      SP_VERIFY: "off"
      # SP_PLUGIN_SCRIPTS: sandbox
    volumes:
      - stronghold-plugins:/app/plugins
volumes:
  stronghold-plugins:
```

### 3.1 断点续玩：Redis 会话 / 对局恢复

设置 `SP_REDIS_URL`（例如 `redis://127.0.0.1:6379/0`）后，服务器每 `SP_REDIS_SAVE_MS`（默认 10 秒）以及**优雅关闭时**把一份状态文档写入 Redis，启动时读回。容器 `docker restart` / `docker compose up -d` 之后，玩家用浏览器重开页面（同一浏览器、同一令牌）就回到原房间原座位。

持久化使用一个按需启动的专用 Worker，独立于战斗 / AI 计算池。检查点的复杂状态编码、JSON 序列化和缓存由该 Worker 完成；Redis 接收已编码的字节。普通本地 Match 仍由主线程提取字段并通过 `postMessage` 复制原始 capture；完整 Match Worker 则在所属 lane 中将 capture 序列化成独占字节缓冲，转移到主线程后再转移给持久化 Worker，主线程不解码、不复制 capture 对象。持久化 Worker 解码后仍调用原来的 `encodeMatchCapture`，保留 Map、波次隐藏排期及原 Redis 文档格式；此字节格式只用于当前进程 IPC，不写入 Redis、不作为跨版本存档。每次等待一局完成后再处理下一局，失败保留最近安全检查点并继续其他局；不回退主线程编码。主线程仍汇总房间/会话、发送控制消息和 Redis 数据，开销并非零，也不承诺降低全进程序列化 CPU。持久化 Worker 故障或超时时跳过本次保存并记录日志；下次保存重建 Worker，从最近成功保存的检查点继续。优雅关闭会等待正在执行的保存，再保存最终状态并关闭 Worker。

可以运行 `node tools/persistbench.mjs` 比较同步快照与 Worker 保存的耗时及 event-loop 心跳间隔。基准重复使用真实四席位对局的第 4 回合休整期状态，FakeBattle 只用于快速构造该状态；不含真实 Redis 网络、并发战斗或浏览器负载，不能用来推断线上容量。

| 会恢复 | 不会恢复 |
|---|---|
| 玩家身份：`playerId` + 重连令牌、昵称、干员调配（DESIGN §16） | 具体的 Socket：客户端用令牌重连后被服务器重新绑定 |
| 房间：代号、模式、难度、房主、座位（真人 + AI）、准备状态、房间的对局计数 | 重连窗口已经过期的会话（同盟 10 分钟 / 独立模拟 24 小时）—— 其房间若因此没人也会一并丢弃 |
| 进行中的对局（包括无房间匹配、房间内匹配和普通房间对局）：回合数、经济、棋盘 / 手牌 / 装备、生命、策略与机变选择、共享池剩余数量、随机数进度、当前阶段 | 战斗本身：检查点只在状态可序列化的阶段生成（信息确认 / 策略选择 / 机变 / 回合开始 / 休整期），所以**在战斗中被打断的对局会从该回合的休整期继续**：阵容与经济原样保留，这一回合重打（战斗 ID 会跳到新的一段，旧上报不会被误收） |
| | 匹配队列本身：尚未开局、仍在等待队友的队列不恢复；只有已经创建并运行的匹配对局会恢复 |
| | 独立模拟的“暂停”（`g.pause`）：恢复后对局是运行状态；当前阶段的剩余时间按检查点记录继续走，休整期至少还剩 20 秒 |
| | 服务器进程内的其他一切：日志、错误统计、诊断信息 |

恢复采用 **best effort**：逐会话、逐房间、逐对局处理，单条损坏记录或单局异常不会阻止其他对局。公共队友和来自其他房间的队友通过原有匹配上下文回到同一对局，不要求出现在主房间的座位表中；主房间记录缺失时，从有效检查点重建房间。仍有有效 token 的玩家优先恢复，即使部署时降低会话容量也不丢弃这些原有身份；新会话的容量限制保持不变。

缺失、过期或已属于其他对局的真人按原有退出规则处理，归还其持有棋子，让其余可恢复玩家继续。已退出的玩家不会重新绑定到旧对局。退出名单与最新战斗序号独立于安全检查点保存，覆盖战斗期间退出及连续重启；旧存档使用已有检查点、房间座位及当前会话归属兼容恢复，不凭空创建 token。开局立即捕获初始安全检查点并触发异步保存；单局捕获失败保留该局上次检查点，其余状态照常保存。

可选字段缺失或损坏时使用兼容默认值，损坏的座位或库存条目尽量局部修复。策略阶段保留已选策略并重建轮次，损坏的机变阶段回到休整期；无法恢复的阶段回退到信息确认或本回合休整期，不重复发放收入、购买结果和已应用的效果。降级恢复会记录原因，**不等同于保证任意损坏存档都能逐字节还原**。健康检查点仍按原状态恢复，战斗仍从最近安全检查点重打。

暂时没有可用真人身份或游戏数据的检查点及关联会话记录保存在状态文档的 `recovery` 中，下次启动再次尝试，不会在下一次保存时被清掉。在同一房间另开新局时，旧检查点标记为被替代的存档，仅保留原始数据，不自动覆盖新局。部分恢复导致对局正常结束时，为仍有效的 token 保存结算消息。Redis 启动读取失败或 JSON 无法解析时，先重试读取，再允许写入，避免覆盖尚未加载的旧状态；未知旧 token 的客户端暂时以 WebSocket 1013 重连等待，不替换其身份。完全丢失的状态或 token 无法凭空重建，升级前仍应备份 Redis。

把 Redis 一起用 compose 起来（`appendonly yes` 让 Redis 自己重启也不丢状态）：

```yaml
services:
  stronghold:
    build:
      context: .
      args: { FETCH_ASSETS: "1" }
    ports: ["3000:3000"]
    restart: unless-stopped
    depends_on: [redis]
    environment:
      SP_REDIS_URL: redis://redis:6379/0
      SP_VERIFY: "off"
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--save", ""]
    volumes:
      - redis-data:/data
volumes:
  redis-data:
```

要点：

- **Redis 只是存档，不是必需**：连不上或中途挂掉时游戏照常运行（只会在日志里看到 `[redis] …` 警告），只是重启不再恢复；服务器会自己重试。
- 状态键默认前缀 `stronghold:`、TTL 25 小时（`SP_REDIS_TTL`，兜底清理）。多个实例共用一个 Redis 时用 `SP_REDIS_PREFIX` 分开。
- 不要把 Redis 配成 `maxmemory-policy allkeys-lru`，否则状态键可能被淘汰。
- 想清空存档（所有人从头开始）：删除状态键即可，`redis-cli DEL stronghold:state`。
- 验证：`GET /metrics` 会返回 `persist: { redis: true, writes, checkpoints }`；启动日志会打印 `State: Redis (…)` 与 `[persist] state loaded (…)`。

### 3.2 素材放 CDN

容器里最占地方的是 `public/assets/`（约 250 MB 图片 / Spine / 音频）。想把它交给 CDN（或对象存储 / 另一台静态服务器）时设置 `SP_ASSETS_CDN`：

```bash
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  -e SP_ASSETS_CDN=https://cdn.example.com/stronghold \
  stronghold-protocol
```

- 服务端在返回 `data/assets.json`、`data/local-assets.json` 时，把其中所有 `/assets/…` 改写成 `<SP_ASSETS_CDN>/assets/…`，因此**客户端零改动**：图片、Spine（skel / atlas / 贴图）、音频、本地提取的素材都自动走 CDN。
- CDN 侧目录结构必须与 `public/assets/` 一致（把该目录整个上传即可），并且**必须允许跨域**：浏览器会用 `fetch` 取 Spine 的 `.skel` / `.atlas`、用 `crossOrigin="anonymous"` 取图片。Nginx 例：`add_header Access-Control-Allow-Origin "*" always;`（音频走 `<audio>`，不需要 CORS）。
- 素材带内容指纹，可以放心设长缓存（`Cache-Control: public, max-age=31536000, immutable`）；`/fonts/` 与 `public/vendor/` 仍由游戏服务器自己提供。
- 没设置该变量时行为完全不变（服务器照旧自己提供 `/assets/…`），设置后本地 `/assets/` 仍然可用，可随时回退。
- 只想换目录名 / 走同源反代前缀也行：`SP_ASSETS_CDN=/cdn`。
- ZIP 资源包可独立配置 `SP_RESOURCE_PACK_ROUTES`（有序 URL/目录模板 JSON 数组），自动逐条故障切换，当前素材 CDN 始终作为最后一条 ZIP 线路；配置、路径重写与 CORS 示例见 [RESOURCE_PACKS.md](RESOURCE_PACKS.md#zip-下载多线路与路径重写)。

验证：`GET /metrics` 里 `assetsCdn` 会显示当前地址；浏览器网络面板里素材请求应指向 CDN。

**数据也放 CDN：** 设置独立的 `SP_DATA_CDN`，把与游戏服务器同一版本的 `data/` 上传到 CDN 根目录下的 `data/`：

```bash
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  -e SP_ASSETS_CDN=https://cdn.example.com/stronghold \
  -e SP_DATA_CDN=https://cdn.example.com/stronghold \
  stronghold-protocol
```

- 页面数据加载器、浏览器战斗模拟和独立素材加载器通过运行时 `/js/asset-cdn.js` 的 `DATA_CDN`，直接请求 `<SP_DATA_CDN>/data/chess.json` 等静态 JSON，无需先请求游戏源站。也支持同源前缀，例如 `/cdn`；移除变量并重启后恢复同源加载。Node 的 `/data/*.json` 始终读取本地数据，保持 GET/HEAD、ETag/304 和原有缓存策略，不再跳转到数据 CDN。
- `data/` 中全部 JSON 都从 `DATA_CDN` 加载，包括 `assets.json`、`asset-hashes.json`、`local-assets.json`、`local-fx.json`、`resource-manifest.json`、`resource-packs.json`、游戏数据和 `data/i18n/` 文本。游戏文本语言包 `/packs/<id>/texts/*.json` 也使用 `DATA_CDN`；UI 语言 `/i18n/*.json` 仍使用 `ASSETS_CDN`。浏览器读取素材清单后，按 `/js/asset-cdn.js` 提供的 `ASSETS_CDN` 改写 `/assets/…`。
- **服务器本地 `data/` 必须保留**，游戏逻辑、插件验证和战斗计算仍从本地读取。数据 CDN 同步使用 `bash scripts/sync-to-r2.sh`：上传完整 data、assets、fonts、语言和可选 resource packs，并在临时目录生成预载 resource manifest，不覆盖本机清单。先将 `config/r2-sync.example.json` 复制为已忽略的 `config/r2-sync.json`，填写 R2 和 CDN 配置；默认预演，加 `--apply` 才上传并清缓存。JSON 配置默认按 CDN 路径前缀清缓存，兼容环境变量模式仍清整个 Zone；均需要 Zone Cache Purge 权限。详见 [R2_SYNC.md](R2_SYNC.md)。CDN 允许 JSON 跨域读取，并设置 `Cache-Control: no-cache` 配合验证器；也可使用带版本号的 CDN 根目录。
- 两个 CDN 变量可以独立配置。`GET /metrics` 的 `dataCdn` 显示当前数据 CDN 根目录；未配置时为 `null`。

更新资源后运行 R2 同步脚本。`/js/asset-cdn.js` 由游戏服务器提供，使用 `no-cache` 和 ETag 校验；代理应保留此缓存策略，以便切换素材或数据 CDN 后浏览器取得新地址。首次升级到所有 data JSON 直连 CDN 的版本需要重新构建前端并重启服务；之后仅切换 CDN 环境变量无需重新构建，刷新页面即可读取启动时的新配置。

R2 CDN 的 `/data/` 映射到上传的 data 目录；游戏域名的 `/data/*.json` 源站接口仍保留，由 Node 读本机 data，`/data/resource-manifest.json` 仍动态生成。玩家客户端通过 DATA_CDN 读取上传的快照；游戏服务器自身不会改为从 CDN 读数据。

界面和游戏文本 JSON 按用途分 CDN，保持原 URL 路径：

| 本机目录 | CDN 路径 |
|---|---|
| `public/i18n/` | `<SP_ASSETS_CDN>/i18n/` |
| `data/i18n/` | `<SP_DATA_CDN>/data/i18n/` |
| `packs/<id>/texts/` 游戏文本 | `<SP_DATA_CDN>/packs/<id>/texts/` |
| `packs/<id>/` UI 语言文件 | `<SP_ASSETS_CDN>/packs/<id>/` |

`/packs/index.json` 继续由游戏源站动态生成，不复制到 CDN；语言 JSON 保持 `Cache-Control: no-cache`、ETag 和允许跨域读取。发布时同步对应文件并清理 CDN 缓存。显式外部 URL 和自定义加载器 `base` 优先。首次升级此加载逻辑需要重新构建并重启服务。

### 3.3 资源预载（可选，客户端开关）

**战斗优先**：本页面进入普通作战、联防、最终攻势或隐秘核心时，自动暂停批量预载及后台缓存核对，
保持用户的预载开关、下载范围和已有缓存；进入结算/休整期或退出对局后自动按最新选择补缺。
观战、单人暂停及自身战场已结束但同局仍作战时也保持暂停。战斗素材的按需加载及 SW 缓存读取照常；
ZIP 导入/导出不被自动取消。战斗中资源窗口不额外扫描缓存、继续下载/检查按钮暂不可用，
可点击“暂停下载”取消战后自动恢复，也可关闭预载或清理缓存；这些手动选择不会被战斗结束反转。
仅控制当前页面后台批量预载，其他标签页的独立任务不受此战斗状态控制。
首次更新需重新构建、重启服务并刷新页面；使用素材 CDN 时同时同步 `public/i18n/` 语言文件。

玩家在游戏里「首页右下角」或「设置 ▸ 预载资源」打开后，客户端会把对局素材存进浏览器缓存（Service Worker + Cache Storage，见 [ASSETS.md](ASSETS.md)「Preload」），之后进战斗不再等待下载：素材由 Service Worker 直接从本机缓存读取。默认关闭，服务端无需任何配置（清单 `GET /data/resource-manifest.json` 由服务端从 `data/assets.json` 自动生成）。部署上只需注意两件事：

- **`/resource-sw.js` 必须由游戏服务器提供，且不要被边缘缓存。** Service Worker 脚本要能立即更新：本项目对 `public/` 下的 `.js` 已经是 `no-cache`，但如果把整个 `public/` 交给 CDN / Cloudflare，请把 `resource-sw.js` 排除（Cloudflare → Caching → Cache Rules：`http.request.uri.path eq "/resource-sw.js"` → **Bypass**）。Nginx 例：

```nginx
location = /resource-sw.js {
    add_header Cache-Control "no-cache" always;
}
```

- 同一浏览器的多个标签页不会各下一遍：客户端用 Web Locks 串行化预载，只有一个标签页在下载（其余显示「另一标签页预载中」，回到该标签页时自动继续）。
- **更新只下变化的文件。** 清单里每个文件都带 `hash`（素材字节的 SHA-1 前 12 位）：本地素材由 `extract.py` 写入，网页素材由 `node tools/asset-hashes.mjs` 生成到 `data/asset-hashes.json`（跟 `data/assets.json` 一起放到服务器/镜像里；**重建 CDN 素材后记得重跑一次**，否则这些条目退回旧的「整个清单换版才失效」规则）。客户端把文件存在一个缓存 `stronghold-resources-v1-all` 里，靠这个 `hash` 决定哪些要重下；旧布局（`stronghold-resources-v1-<指纹>`）的缓存会被**迁移**而不是丢弃：客户端现算旧条目的 SHA-1，仍然一致的就搬进新缓存，不一致的删掉再下——所以这次上线不会让已预载的玩家把 330 MB 重下一次。
- **音频走 `/media/…`（0.1.2 起）。** 没有配置 CDN 时，客户端播放 BGM / 音效请求的是无扩展名地址 `/media/bgm/act1`（`shared/media.js`：避免 IDM / 迅雷 这类下载管理器嗅探 `.mp3` 请求），由服务端解析回 `public/assets/audio/…`。预载清单里记的**仍然是真实文件路径**（CDN 是纯静态托管，认不了 `/media/…`），Service Worker 会把这条路由映射到清单里的那条记录 —— 所以走不走 CDN，音频都命中预载缓存；`/media/…` 的响应头和直接请求 `/assets/audio/…` 一样（一天缓存、支持 Range）。
- **素材需要允许跨域读取**（与 §3.2 同一条要求）：预载会用 CORS 模式 `fetch` 素材并把响应写进缓存，缺 `Access-Control-Allow-Origin` 时该文件会被记为失败（游戏本身照常按需加载）。想确认预载是否生效：浏览器 DevTools → Application → Cache Storage 里应出现 `stronghold-resources-v1-all`，文件数为「已保存/总数」。

### 3.4 上限调整（房间 / 对局 / 连接）

服务端对「一个网络能占用多少」有几道上限。默认值适用于家用小主机与几十人的公网部署；容器里用环境变量就能调，不必改代码：

| 环境变量 | 默认 | 含义 | 客户端看到 |
|---|---|---|---|
| `SP_MAX_ROOMS` | `1000` | 全局同时存在的房间数（**含正在对局的房间**） | 「服务器内部错误」 |
| `SP_MAX_ROOMS_PER_ADDR` | `16` | 单个客户端网络同时拥有的房间数（`0` = 不限） | 「操作过于频繁」 |
| `SP_MAX_MATCHES_PER_ADDR` | `8` | 单个客户端网络同时进行的对局数（`0` = 不限） | 「操作过于频繁」 |
| `SP_MAX_CONNECTIONS` | `2000` | 全局 WebSocket 连接数 | 升级时 HTTP 503 |
| `SP_MAX_CONNECTIONS_PER_ADDR` | `64` | 单个客户端网络的连接数（`0` = 不限） | 升级时 HTTP 429 |

例子（`.env` 或 compose 的 `environment:`）：

```yaml
    environment:
      SP_MAX_ROOMS: "2000"            # 大服务器：放宽全局房间数
      SP_MAX_ROOMS_PER_ADDR: "32"     # 宿舍 / 校园网 / CGNAT：多人在同一出口 IP
      SP_MAX_MATCHES_PER_ADDR: "0"    # 0 = 不限制（只保留全局兜底）
```

几点要注意：

- 「一个网络」怎么算：直连时是客户端 IP（IPv6 取 /64）；经过反代 / Cloudflare 时是转发头里的真实玩家 IP（`cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`）。**本机/内网直连不受单网络限制**。
- 若把 `TRUST_PROXY` 设为 `0`，经本机反代的流量全部算作「本地」→ 单网络上限**完全不生效**，只剩全局兜底；默认 `auto` 才会按真实玩家 IP 计数。
- 房间只在真的变空时才释放：大厅断线满 60 秒，或对局中重连窗口结束（同盟 10 分钟、**独立 24 小时**）。**打完一局不会释放房间**（只是回到大厅，仍计入上限）。
- 程序内调用还可以直接传 `startServer({ maxRooms, maxRoomsPerAddr, ... })`；显式传的参数优先于环境变量（便于测试），环境变量优先于代码默认值。值写错了（负数、小数、非数字）会记一条 warn 并继续用默认值——不会因为一个手误把防护关掉。
- **容量与 CPU**（单机实测，见本节末尾的容量说明）：一局 4 人合作在 **客户端战斗**（默认）下约用 **8–10 s CPU**，其中 AI 席位的"预演摆位"占约 70%（`SP_BOT_REHEARSAL=0` 可降到 2.7–3.5 s）。摊到 25–30 分钟的一局就是 **每房约 0.5–0.7% 单核**；1000 名玩家 = 250 房 ≈ **1.3–1.8 核**（这还是"每个房间都塞满 AI 席位在预演"的最坏情况）。真正会把它打爆的是 `SP_COMBAT=server`（改为按 tick 推快照，数量级上升）与 `SP_VERIFY=all`（每局客户端上报的战斗服务器再算一遍）；Redis 在 250 个活对局时约 3.6 MB/10 s（≈370 KB/s，AOF 约 32 GB/天，可用 RDB 快照或把 `SP_REDIS_SAVE_MS` 调到 30 s 降下来）。启动日志里 `[match] tuning:` 一行和 `GET /metrics` 的 `tuning` 字段会报出当前生效的 `combat` / `verify` / `botRehearsal`。
- 观察方式：启动日志有一行 `[http] limits: rooms 1000 (16/network), matches 8/network, sockets 2000 (64/network)`；`GET /metrics` 的 `limits` 是当前生效值，`usage` 告诉你**最忙的那条网络离上限还有多远**：

  ```json
  "usage": { "rooms": 3, "matches": 1, "networks": 2, "worstRooms": 2, "worstMatches": 1,
             "overRooms": 1, "overMatches": 1, "socketNetworks": 2, "worstSockets": 2, "overSockets": 1 }
  ```

  `networks` = 当前占用房间/连接的客户端网络数，`worst*` = 最忙那条网络占用的房间 / 对局 / 连接数，`over*` = 已经达到上限的网络数（**> 0 就说明有网络正在被限流**）。判断方法：如果 `overRooms` 一直大于 0、`worstRooms` 贴着 `maxRoomsPerAddr`，就是某条出口 IP（宿舍 / 公司 / CGNAT）挤爆了，调大它比调大全局上限更对症。
  出于隐私，`/metrics` 是公开端点，**不会列出客户端地址**；具体是哪个 IP 被拒只出现在服务端日志里（`[lobby] room limit (N) reached for <ip>` / `match limit (N) reached for <ip>`，同一条 10 秒内只打一次并附上被合并的次数）。

### 3.5 多核计算：固定 Worker 池

默认模式下，服务器为所有房间共用一个计算池。WebSocket、经济、结算和 Boss 共享血量由主线程管理；Worker 只计算 AI 候选布局评分、普通/联防战场的完整模拟和客户端结果复算。`SP_COMBAT=server` 的实时推流和 Boss 共享战场仍使用主线程的原有调度。下面的计算池队列、重建和回退规则适用于该模式，不等同于完整对局 Worker。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `SP_WORKERS` | `min(8, max(1, 可用 CPU 数 − 2))` | 固定线程上限，0 关闭，1–32 手动指定；CPU 数使用 Node `os.availableParallelism()`，部署时结合容器 CPU 配额和内存调整 |
| `SP_WORKER_QUEUE` | `256` | 等待队列上限，不包含正在执行的任务；0 表示只接受可立即分配的任务 |
| `SP_WORKER_TIMEOUT_MS` | `120000` | 从提交开始计时，包含排队；超时的运行线程被终止，再有任务时重建 |

例如 8 核机器可以设置 `SP_WORKERS=6`。线程按需启动，第一次使用时获得当前服务器的游戏数据快照，后续任务只传战斗输入。每个线程一次执行一个任务；严格校验和接管优先于 AI 预演及抽样校验。

`SP_VERIFY=all` 的普通/联防战场进入等待校验状态，计算结束后才结算，重复上报不会重复计算。请求的 `ok` 表示已接收上报，最终战场状态通过原有 `m.public` 更新。抽样校验仅记录差异，队列满或计算失败时跳过。严格校验、AI 预演或接管失败会退回本地分片；严格校验失败会由服务器重新模拟，不能直接放行客户端结果。

准备阶段结束、玩家退出、战场被替换或对局销毁时，相关任务会取消，晚到的结果不能覆盖新状态。服务器关闭时停止计算池。虚拟时间工具和注入自定义 Battle 的测试保持同步执行。

启动日志的 `[workers]` 和 `/metrics` 的 `workers` 可查看线程上限、已启动线程、忙线程、队列长度，以及完成、失败、取消、拒绝计数；`queueMs` / `computeMs` 是累计排队/运行毫秒数，`avgComputeMs` 是成功完成任务的平均计算毫秒数（不含排队、超时和取消；运行时间包含首次线程初始化）。队列持续积压时，应降低开局速率或增加资源，避免依赖分片回退维持过载。

本机基准：`node tools/workerbench.mjs --workers 4 --battles 24`。工具先预热，再比较相同战斗的同步执行和 Worker 池执行，输出结果摘要一致性、吞吐及主线程定时器最大延迟。它不包含真实 WebSocket 流量、Redis 写入或完整对局，不能作为在线玩家容量承诺。

**内存诊断**：Docker 的 `MEM USAGE` 是容器总内存。`/metrics.memory.rss` 是整个 Node 进程的驻留内存（含所有 Worker）；同一对象的 `heapUsed` / `heapTotal` / `external` / `arrayBuffers` 是主线程计数，单位均为字节，`arrayBuffers` 已包含在 `external` 中，不能再相加。`workers.memory[].sample` 与 `persist.workerMemory` 是各线程最近完成任务时的采样，`sampledAt` 是采样时间，包含尚未 GC 的临时对象，不是当前实时堆。

模拟 Worker 各有独立 JS 堆和游戏数据副本，启动后为复用而保持存活。`SP_WORKERS=4` 比默认最多 8 个线程节省内存，但会减少计算并发度，调低后应观察任务队列和超时。静态 gzip 缓存按字节淘汰，上限 96 MiB，实际占用见 `/metrics` 的 `staticCache.gzipBytes`；WebSocket 发送积压见 `socketBuffers.total` / `max`；`persist.snapshotBytes` 是最近保存的 JSON 字节数。房间数不等于活跃对局数，`matches` 包含所有运行对局，`roomMatches` / `standaloneMatches` 区分房间与无房间匹配。

本地检查可运行 `node --expose-gc tools/memorybench.mjs`：比较 276 个信息确认阶段房间创建 / 销毁前后的主线程堆，以及 1 / 4 / 8 个 Worker 完成真实战斗后的进程 RSS。仅对主线程显式 GC，不采集生产环境，也不模拟 276 场同时战斗，不能当作生产内存上限。房间 / 对局销毁后主线程已用堆下降，而 RSS 不马上下降，可能是其他线程、V8 保留的堆或原生分配器的高水位；应结合持续采样判断是否泄漏，不能只凭一个 Docker 数值定性。

计算池支持单进程利用多个核。多实例部署仍需房间/重连路由和独立存档归属；直接用 PM2 cluster 并共用同一 Redis 存档键会导致路由错误和存档覆盖。

**可选房间分流**：`SP_ROOM_WORKERS=1..32`（默认 0，不能超过 `SP_WORKERS`）只把模拟任务按房间固定到计算线程组，对局对象仍在主线程。`SP_MATCH_WORKERS=1..32`（默认 0）则把完整对局状态、计时器、AI、视图和结算移到独立线程，主线程保留 WebSocket、身份、大厅和房间目录；`/ws` 路径与客户端协议不变。这些线程额外计入进程 CPU/内存预算；完整对局模式不会使用主线程计算池来执行其对局内部任务，不能把两组线程数相加当作对局并行度。

完整对局模式在等待初始化完成前同步占用房间及匹配身份；初始化期间的退出、关闭和失败会取消并清理该实例。实例带有独立代号，旧对局的回调或延迟销毁不能影响复用同一房间号的新对局。潜能/练度及“AI 最后选择”在普通开局、匹配开局和恢复路径中保持一致。

每个完整对局 lane 在首次使用时只接收一次服务器游戏数据快照，先安装为该线程的数据源，再导入游戏模块；同 lane 的多个 Match 共用这份深冻结数据，但玩家库存、共享池、RNG 和对局状态各自独立。开局、同房间再开及检查点恢复不重复传输完整数据。Worker 的有效单播/广播只携带消息类型和 JSON 编码，不再同时复制完整消息对象；主线程复用同一编码用于发送及结算回放，旧回调读取完整字段或枚举消息时才按需解码，旧式对象 IPC 仍兼容。私人状态编码继续独立。状态增量从编码解析自己的快照，不借用回调暴露的可变对象；旧客户端转发不需要解码完整消息，现代客户端只按原有基线规则解析一次传输快照。初始化回复提供完整代理元数据，后续回复仅传发生变化的字段，玩家连接/退出及战斗序号变化仍同步；IPC 复制失败不推进元数据基线。

这些优化不迁移主线程的 WebSocket 收发、状态增量解析/diff/编码及连接基线；持久化仍经主线程转交，但完整 Match capture 仅转移缓冲所有权。可靠入队后才推进状态基线及操作确认的语义不变。默认仍不启用完整对局 Worker；线上须核对 `/metrics.matchWorkers` 的存在、`rooms` 和 `failedLanes`，普通 `workers.threads` 不能代替完整对局启用证明。`handlerMs` 只统计主线程同步回调，不包含 Worker 等待/执行及异步回复发送；启用后该值下降不等于操作状态到达延迟下降。

本机 IPC 微基准：`node tools/match-workerbench.mjs --matches 32 --lanes 2 --rounds 100`。创建真实四人 Match，但只发送过期战斗进度消息；报告数据传输次数、无变化回复的元数据数量、编码广播数量、往返耗时、主线程事件循环利用率及全进程 CPU 时间（含所有 Worker）。不包含实际战斗、WebSocket、Redis、TLS、浏览器或线上容量；主线程事件循环 active 时间不等于主线程 CPU。验收仍需真实多房间操作状态解码 p95、失败率、主线程 CPU 与内存，不能用微基准或普通确认耗时替代。

更窄的缓存/传输微基准：`node tools/server-hotpathsbench.mjs --matches 32 --lanes 2 --rounds 20 --checks 50`，分别测量资源清单缓存命中正文读取次数、真实四席 Match 强制公共状态经 IPC 转发到模拟连接，以及 INFO_CHECK 检查点保存到内存接收器；报告重复消息对象、capture 对象/转移缓冲数量及主线程 postMessage 同步耗时。只用于路径对照，不包含真实 WebSocket、Redis、战斗、TLS、浏览器或部署，不能据此承诺线上满核已解决。

`SP_WORKER_TIMEOUT_MS` 同时限制完整对局 Worker 的单次 IPC 请求（默认 120000 ms，从请求发往线程起计时，不包含代理串行队列等待）。线程错误、意外退出（包括退出码 0）或请求超时会隔离该线程并拒绝后续请求；不重试可能已执行的游戏操作，也不把其权威状态转移到主线程。`/metrics.matchWorkers` 的 `failedLanes` 和 `lanes[].failed` 显示故障，`threads` 为尚未退出的线程数，`rooms` 包含仍为持久化保留的故障对局代理；`busy` 仅表示有待回复 IPC，不代表实时 CPU 占用。新对局只使用健康线程；全部线程故障时拒绝开局。

持久化继续保留故障对局的最近安全检查点，并保存其他健康对局及主线程已确认的退出名单；安全检查点尚未成功保存的对局不能承诺恢复。完整对局线程当前**不支持在线自动重建或对局自动迁移**；配置 Redis 时需优雅保存并重启服务后按原有 best-effort 规则恢复，战斗中断仍回退最近安全阶段。无 Redis 时线程崩溃丢失的状态无法恢复。不要套用模拟计算池“失败后重建并重试”的规则；也不要从这些边界测试推断晚高峰容量。

**高并发 WebSocket 延迟**：全服广播与心跳每批最多处理 128 个连接或连续工作 2 ms，批次间让出主线程，广播之间保持 FIFO 顺序。在线人数每 10 秒最低优先级刷新，只保留最新待发快照；普通广播/心跳及操作回复先处理，忙连接跳过本轮，welcome仍即时提供在线人数；关闭或已替换的连接不会继续接收旧批次。普通/联防的本地模拟回退及 AI 预演续步共用 FIFO 工作队列，每轮预算 4 ms；一个不可中断的步骤可能超过预算，但随后必须让出事件循环，不再让所有房间各自的分片在同轮集中执行。虚拟时间调度保持原有行为。私有状态发送复用去重时生成的 JSON，匹配分组按队伍大小维护 FIFO 候选，批量开局只在结束后广播剩余队列人数。

资源清单缓存命中先检查三个源清单及已发现的棋盘裁切表的 size/mtime，不读取正文、不重新 CDN 改写或遍历全部素材；并发检查/重建只共享进行中的任务。源清单或裁切表出现、删除和变更仍使缓存失效，后续请求重新检查，不长期缓存检查结果；失败返回错误而非伪装旧数据，重置时未完成的旧任务不得覆盖新缓存。HTTP 的 ETag、gzip、GET/HEAD、304 及资源指纹协议不变。

`/metrics.websocket.diagnostics` 提供仅服务端保留的诊断，不增加 `/healthz` 字段、不记录地址或消息内容：

- `eventLoop`：20 ms 分辨率的事件循环采样，包含利用率、平均/最大间隔及 p95/p99，单位 ms。采样本身包含约 20 ms 的正常定时间隔，不能把全部数值当作额外阻塞时间。
- `handlerMs`：按合法消息类型聚合，从收到帧进入 JavaScript 回调到同步处理完成的时间，包含解析、校验及回复入队，不含回调被调度前的等待。`p95UpperMs` / `p99UpperMs` 是有界直方图给出的百分位上界。
- `receivedFrames` / `sentFrames` 和对应 `Bytes`：累计帧数及应用消息字节数；发送字节为压缩前的 UTF-8 长度，不能当作实际出口流量。相邻两次采样的差值除以间隔可计算速率。
- `sendCompletionMs`：每 64 次发送采样一次，从入队到本机发送回调成功的耗时，包含压缩和本机发送排队，不代表客户端收到或 RTT。
- `droppedSnapshots` / `slowDisconnects`：因原有背压阈值跳过快照、断开严重积压连接的累计次数。

**Grafana持续监控**：仓库的 `deploy/monitoring/README.md` 提供独立collector、Prometheus、Grafana部署配置和中文面板，不更改游戏JSON `/metrics` 或健康检查入口。更新后的diagnostics另提供 `processCpu` 累计进程CPU秒、`recentEventLoop` 独立10秒窗口及 `handlerMs`/`sendCompletionMs` 的累计 `sumMs`/`buckets`；旧字段与sinceStart口径保留。未采集的玩家“操作状态真正到达”延迟仍明确标注，不用匿名ping或本机发送耗时替代。面板/监控配置仅在源码仓库提供，发行包不自动附带，部署前按该目录说明单独准备。

这些统计的 `period` 为 `sinceStart`，从本进程启动起累计；最大值与百分位可能保留早期高峰，不表示最近一分钟。事件循环利用率高、处理时间高和 `socketBuffers` 增长分别指向主线程负载、同步处理及发送拥堵，应结合 Worker 队列和出口带宽判断。8 核未限制配额时默认最多 6 个模拟 Worker；不要因 WS 延迟直接增加线程数。压缩仍默认开启，可在相近负载下对比 `SP_WS_COMPRESSION=off`，关闭会增加带宽，环境变量须在重启服务后生效。

本地协议压测：`node tools/wsbench.mjs --sockets 2500 --seconds 12 --compression on`，再用 `--compression off` 在相近条件下运行。工具自动启动独立服务进程和压测进程，创建 625 个四人房间，分散发送 ping 和准备/取消准备操作，输出两种回复的 p50/p95/p99、错误数及服务端诊断；不会连接生产服务。`--push-bytes 4096` 每 250 ms 增加一次合成全服大消息，`--legacy-fanout` 仅在压测子进程恢复同步广播，可用于对比分批效果。合成正文高度可压缩；测试不包含战斗、AI、Redis、TLS、反向代理、浏览器和真实网络，不能据此承诺线上 2500 人对局容量。应在空闲机器顺序运行，避免压测与其他检查抢占 CPU；服务端累计诊断包含建连/建房预热，客户端 RTT 样本仅取测量阶段，最多保留 100,000 个样本。

**高频健康检查**：`/healthz` 的常见 GET/HEAD 请求同步处理，复用预编码 JSON；不经过异步公共 API 路由。每个服务实例只保留一份按需更新的房间/队列统计，稳定状态下最多每秒扫描一次，房间数、活跃队列对局数或排队玩家数变化时立即刷新；连接数、会话数、运行时间继续及时更新。既有房间内部的座位、观战或对局计数可能有最多约 1 秒的快照延迟，字段及统计含义不变。有效期使用单调时钟，无后台扫描定时器；刷新失败返回 500，下次重试。此复用仅发生在服务器内，HTTP 仍为 `Cache-Control: no-store`，HEAD 长度与对应 GET 一致。`/metrics` 仍实时收集全部统计，不读取或更新健康快照。更新检测继续使用启动时固定的 `build`，无需增加客户端轮询频率。

`node tools/healthbench.mjs --rooms 625 --reads 100000` 对比真实 `Lobby.stats()` 与健康快照复用的 CPU 开销，使用合成房间、验证所有计数字段一致并输出扫描次数；不包含 HTTP、TLS、代理或真实对局，不能将输出的读取速率当作 HTTP 吞吐量。

### 3.6 全站临时公告

公开 HTTP 接口提供房间状态、跨域延迟探测和公告读取，详见 [CUSTOM_API.md](CUSTOM_API.md)。`/api/announcement` 保持读取滚动公告，`/api/popup-announcement` 独立读取弹窗公告。滚动及旧定时弹窗的 `expiresAt` 为 `startAt + durationSeconds × 1000`；长期弹窗为 `null`。

编辑 `config/announcements.json`，服务器每 2 秒读取一次，修改无需重启。条目通过 `type` 分成两种独立类型：`scroll` 为滚动公告，省略时也按此类型处理，兼容已有排期；`popup` 为弹窗公告。滚动公告在首页、大厅、房间和游戏内的上半屏滚动展示，不显示剩余时间，不拦截游戏操作，到期自动消失。开启系统“减少动态效果”时改为静态换行文本。默认配置为空，`config/announcements.example.json` 分别提供两种未启用的示例。

大厅和房间顶部的“公告”按钮只打开当前有效的 `popup` 公告；标题页和设置中也保留入口，无有效弹窗公告时显示“暂无公告”，即使还有滚动公告。弹窗展示标题（省略时为“公告”）、正文及可选详情链接。`autoPopup` 默认 false，只通过按钮打开；设置为 true 时，弹窗公告生效或玩家进入非对局页面后自动打开。对局期间（含开局准备、观战和结果页面）延后自动弹出，回到大厅或其他非对局页面时，仅弹出仍有效且未查看的当前公告；延后期间不记录为已查看。进入对局时会关闭自动打开的公告，手动打开的公告不受影响。同一浏览器最近 100 个已查看版本不会重复自动弹出，刷新、重连、页面切换或同类型高优先级公告结束后恢复旧公告都不会重复打开；修改标题、正文、格式、链接、自动弹出开关或有效时间视为新版本。手动查看不受此限制。关闭、到期或撤回弹窗公告不影响滚动公告，反之亦然；自动打开的弹窗在对应公告到期或撤回后关闭。

**popup 不再强制设置时间。** 省略 `startAt` 即立即生效；省略 `durationSeconds` 和 `endAt` 即一直有效，
直到设为 `enabled: false`、删除条目或清空公告列表。重新加载配置和重启不会改变公告版本。
已有显式 `startAt` / `durationSeconds` 仍按原排期生效，但 popup 的持续时间不再限制为一天。
想将旧定时 popup 改成长期公告，请移除其 `durationSeconds`；若也不需要开始时间，一并移除 `startAt`。

```json
{
  "announcements": [
    {
      "id": "maintenance-20261005",
      "type": "scroll",
      "text": "服务器将在今晚 22:00 进行维护，请提前完成当前对局。",
      "startAt": "2026-10-05T21:50:00+08:00",
      "durationSeconds": 60,
      "level": "warning",
      "enabled": true
    },
    {
      "id": "update-details",
      "type": "popup",
      "title": "更新公告",
      "format": "markdown",
      "text": "## 本次更新\n\n欢迎使用 **新版本**。\n\n- 多个 [链接](https://github.com/xinhai-ai/Stronghold-Protocol)\n- 支持图片\n\n![截图](https://example.com/news.png)",
      "url": "https://github.com/xinhai-ai/Stronghold-Protocol",
      "autoPopup": false,
      "level": "info",
      "enabled": true
    }
  ]
}
```

上例 `example.com/news.png` 是图片地址占位符，请替换为实际图片 URL；也可写站内 `/icons/app-192.png`。

- `id`：唯一标识，1–64 个字母、数字、下划线或短横线。
- `type`：`scroll`（默认，滚动公告）或 `popup`（弹窗公告）。同一条目只能属于一种类型。
- `text`：滚动公告 1–500 个 Unicode 码点，保持纯文本且换行合并为空格；popup 1–16000 个 Unicode 码点，保留换行和正文缩进。
- `format`：仅 popup 可选，`plain`（默认、兼容旧正文）或 `markdown`。Markdown 支持六级标题、段落/换行、粗体/斜体/删除线、有序/无序/任务列表、引用、分隔线、代码块、表格、多个链接和图片。不执行原始 HTML、脚本或任意 CSS。图片宽度不超过弹窗，表格/代码块可横向滚动，正文纵向滚动时关闭按钮保持可见。
- Markdown 链接/图片地址只接受完整 HTTP(S)（无账号密码）或 `/` 开头的站内路径；不接受 `javascript:`、`data:`、`blob:` 或 `//` 协议相对地址。链接新窗口打开；图片懒加载且不发送 Referer。站内图片可放在 `public/` 的独立目录，如 `public/announcements/update.png`，正文写 `/announcements/update.png`；这类公告图片不纳入游戏素材预载 ZIP。外部图片由玩家浏览器直接请求，可能向图片服务商暴露客户端 IP，HTTPS 页面请使用 HTTPS 图片。
- `textFile`：仅 popup 可选，用本地 `.md` / `.txt` 文件代替 `text`，两者不能同时填写。相对于公告 JSON 所在目录，只允许该目录以内的相对路径（包括子目录），不能引用远程 URL、绝对路径、`..` 或指向目录外的符号链接。`.md` 默认 Markdown，`.txt` 默认纯文本，也可显式设置 `format`。文件正文编辑同样每 2 秒热更新，不需要修改 JSON；缺失、超长或非法正文保留最后一份有效公告。设为 `enabled: false` 时不读取正文文件，因此文件缺失或正在编辑也能撤回。配置示例正文见 [announcement-popup.example.md](../config/announcement-popup.example.md)。
- `title`：可选，去除首尾空白后 1–80 个 JS 字符单位，不支持控制字符。
- `url`：仅 `popup` 可选，详情链接，最多 2048 字符，只接受不含用户名、密码或空白的完整 HTTP(S) 地址；不需要链接时省略此字段。
- `autoPopup`：仅 `popup` 可选布尔值，默认 false；true 自动弹出，false 仅在点击公告按钮时打开。
- `startAt`：滚动公告必填；popup 可省略或为 `null`，立即生效（内部开始边界为稳定的 0）。填写时为带时区的 ISO 日期，必须明确 `+08:00` 或 `Z` 等时区，不能使用 `now`。
- `durationSeconds`：滚动公告必填，1–86400；popup 可省略/为 `null` 表示不按时长到期，填写时须为正整数并同时填写 `startAt`，没有一天上限，但结束时间必须仍在可表示的日期范围内。显式旧排期不延长，界面不显示倒计时。
- `endAt`：仅 popup 可选，直接填写结束时间（带时区 ISO 日期）；不得与非空 `durationSeconds` 同时设置，必须晚于开始边界。不填写两个结束选项就是长期公告。
- `level`：`info`（普通，默认）、`warning`（提醒）或 `urgent`（紧急）。
- `enabled`：布尔值，默认 true；设为 false、删除该条目或清空数组可撤回。

配置两种类型合计最多 100 条，JSON 和各正文文件分别最多 128 KiB，正文文件展开后的完整 JSON 也不得超过 128 KiB。每种类型独立选择等级最高的一条，两类可同时有效，互不竞争；同等级先显示开始边界较早的（无开始时间视为 0），同一开始边界按文件顺序。等待中的定时公告仍按原计划到期，不延长有效期。配置格式有误、文件不可读或保存时暂时缺失时，保留上一份有效配置（长期 popup 保持有效）；日志和 `/metrics.announcements.configError` 可定位原因，`activeId` 为滚动公告、`popupActiveId` 为弹窗公告。清空时请写入合法的 `{"announcements": []}`，不要用删除文件代替撤回。

推荐将 popup 正文单独放在 Markdown 文件，配置只保留少量元信息：

```json
{
  "announcements": [{
    "id": "server-news",
    "type": "popup",
    "title": "服务器公告",
    "textFile": "announcement-popup.example.md",
    "autoPopup": true,
    "enabled": true
  }]
}
```

这是完整列表示例，不要直接覆盖正在使用的排期；把条目追加到现有 `announcements` 数组即可。
Docker 部署时将正文文件与 JSON 一起放进挂载的配置目录，图片另行部署到站点可访问目录。
首次升级此功能需要安装新增依赖、重新构建并重启本分支服务器；之后改公告正文不必重启。

PowerShell 立即发布一条持续 60 秒的通知（会替换现有列表）：

```powershell
$notice = @{ announcements = @(@{
  id = 'quick-notice'; text = '服务器即将更新，请留意后续通知。'
  startAt = [DateTimeOffset]::Now.ToString('o'); durationSeconds = 60
  level = 'info'; enabled = $true
}) }
$notice | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 config/announcements.json
```

**Docker 支持实时修改。** 镜像包含默认的 `config` 目录；建议挂载整个目录，容器内 `node` 用户只需读取权限：

```bash
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  --mount type=bind,source="$(pwd)/config",target=/app/config,readonly \
  -e SP_ANNOUNCEMENTS_FILE=/app/config/announcements.json \
  stronghold-protocol
```

在 Docker Compose 服务中加入：

```yaml
    environment:
      SP_ANNOUNCEMENTS_FILE: /app/config/announcements.json
    volumes:
      - ./config:/app/config:ro
```

之后修改宿主机 `config/announcements.json` 或其引用的本地正文文件即可。挂载目录可以识别编辑器通过新文件替换旧文件的保存方式；只挂载单个文件可能看不到这类替换。配置必须在挂载前存在。容器重启恢复长期 popup；定时公告读取原来的绝对时间，恢复未到期通知，过期通知不补播。公告由配置文件保存，独立于 Redis；多个实例若使用相同配置，需要保持服务器系统时钟同步。

## 4. macOS / Linux 常驻

- 临时开服：`scripts/start.sh`（或 `npm start`），保持终端窗口打开。macOS 首次会询问是否允许 node 接受传入连接，选「允许」。
- Linux systemd（`/etc/systemd/system/stronghold.service`，路径与用户按实际修改）：

  ```ini
  [Unit]
  Description=Stronghold Protocol game server
  After=network-online.target
  Wants=network-online.target

  [Service]
  WorkingDirectory=/opt/Stronghold-Protocol
  ExecStart=/usr/bin/node server/index.js
  Environment=PORT=3000 HOST=::
  Restart=always
  RestartSec=5
  User=stronghold

  [Install]
  WantedBy=multi-user.target
  ```

  `sudo systemctl daemon-reload && sudo systemctl enable --now stronghold`；日志 `journalctl -u stronghold -f`；防火墙 `sudo ufw allow 3000/tcp`。

## 5. 排错

| 现象 | 处理 |
|---|---|
| 任何问题 | `node tools/doctor.mjs`：Node 版本、依赖、素材完整性、端口、局域网地址、防火墙、网络类型 |
| `端口已被占用 / EADDRINUSE` | 已经有一个服务器在运行（自启任务？）或其他程序占用 3000：换端口 `scripts\start-windows.bat --port 3001` |
| 朋友打不开页面 | 防火墙规则 / 网络类型（1.2）；确认用的是 `LAN` 地址而不是 `localhost`；访客 Wi-Fi 常开启「AP 隔离」；不在同一网络请看第 2 节 |
| 画面是占位图、没有声音 | 素材没下完：重新运行 `node tools/setup.mjs`（会续传）；缺失明细在 `.cache/assets-report.json`。默认仅原始源和 jsDelivr；可用 `--asset-source=mirror` 手动开启前缀镜像（见上文） |
| 素材下载很慢 / 失败 | 网络问题可随时中断，重新运行会跳过已完成的文件；`node tools/fetch-assets.mjs --concurrency=4` 降低并发。有文件没下载成功时，素材清单 `data/assets.json` 保持不变（脚本列出缺少的条目并以非零状态结束；游戏里缺的图片用占位图，缺的声音不播放），重新运行即可补齐 |
| 表情显示成默认图标、「玩法说明」只有文字要点 | 素材没下载完整：重新运行 `node tools/setup.mjs`（表情和教程图随其他素材一起从公开镜像下载，不需要客户端）；缺失明细在 `.cache/assets-report.json` |
| 本地提取失败 | 游戏照常运行，只是第 6 节表格里的几样换成替代样式。确认客户端已下载全部资源；Python 版本太新导致依赖安装失败时，安装 Python 3.12 后删除 `.venv-extract` 再运行 `node tools/setup.mjs --local` |
| 3D 棋盘没出现 | 需要本地提取的棋盘贴图（`node tools/doctor.mjs` 会显示「3D 棋盘可用」），以及支持 WebGL2 的浏览器。没有客户端的服务器可以从同一版本的整合包复制本地素材（第 6 节） |
| 想知道开服电脑上传了多少流量 | 浏览器打开 `http://localhost:3000/healthz?traffic=1`（换成你的端口）：`traffic.http` 是服务器启动以来各类内容（`assets` 图片和模型、`audio` 音频、`code` 页面和脚本、`data` 游戏数据和素材清单）发出的字节数和请求数（压缩后的实际字节，`notModified` 是只回了「没变」的 304），`traffic.ws` 是 WebSocket 的线上字节（`wireOut` / `wireIn`，压缩后）和压缩前的消息字节（`payloadOut` / `payloadIn`）。数字只在内存里，重启后从 0 开始；只有本机和局域网（含虚拟局域网地址）的访问能看到，公网访问者（包括经隧道 / 反代转发来的）只拿到普通的 `/healthz`。玩家那边：设置 →「问题反馈」复制的诊断里有一行 `traffic:`，是这个页面从打开起下载的字节数（`cached` 是浏览器缓存直接给的，不占流量；`external` 是其他网站，例如 Google 字体） |
| 断线 | 同盟模拟 10 分钟内、独立模拟 24 小时内（`config.constants.singleReconnectTime`）用同一浏览器重新打开页面，自动回到原座位。同盟掉线期间按原阵容自动作战、到时自动准备（不会代为购买；想让 AI 代打请用「离开模拟 → 暂离（AI 托管）」）；独立模拟不计时，等你回来 |
| 重启（容器 / 进程）后玩家回不到房间 | 没设 `SP_REDIS_URL` 时这是预期行为（纯内存）。设了之后看启动日志的 `State:` 行和 `[persist] state loaded (…)`；`GET /metrics` 的 `persist.writes` 应持续增长。宕机超过重连窗口（同盟 10 分钟 / 独立 24 小时）的会话必然丢弃 |
| 日志刷 `[redis] connect failed / write failed` | Redis 不可达或权限不对；对局本身照常进行（只是重启后回不到房间，同上一行）。确认地址（`redis://主机:端口/库号`）、有没有设密码（`redis://:密码@主机:6379/0`）、容器网络里主机名是否是服务名 |
| 设为 CDN 后素材 404 / 控制台报跨域 | CDN 目录结构必须与 `public/assets/` 一致；Spine 的 `.skel` / `.atlas` 靠 `fetch` 读取，需要 `Access-Control-Allow-Origin`。先直接访问 `<CDN>/assets/char/avatar/char_002_amiya.png` 确认能打开 |

## 6. 本地客户端素材（可选）

`public/assets/local/` 和 `data/local-assets.json` 是从本机安装的《明日方舟》客户端里提取的官方素材（`tools/local-extract`，DESIGN §13）：`node tools/setup.mjs` 检测到客户端时会询问是否提取，之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定客户端目录。setup 从公开镜像下载的素材不包含这部分，所以在没有客户端的电脑上（例如 Linux 服务器）用源码或精简包部署时不会有它；Releases 的完整包里已经带上了。

没有本地素材时游戏照常运行，只是下面几样换成替代样式：

| 内容 | 没有本地素材时 |
|---|---|
| 官方 3D 棋盘（贴图、模型、地图特效） | 2D 棋盘，地块由程序绘制 |
| 各战场的官方场景（沙地等 11 个战场，0.2.5 素材包；完整包在提取后带上，精简包和源码可在本机下载并提取，见下） | 3D 棋盘用程序生成的金属地块 |
| 部分官方界面图标与底板：交流按钮和表情面板的边框、暂停面板、装备替换窗口、干员调配界面、队友状态与漏怪标记、模组类型图标等 | 样式相近的替代图形、图标或文字 |
| 灼热 / 炽焰源石虫的官方模型 | 染成橙色 / 红橙色的普通源石虫 |
| 39 个召唤物的官方模型（多数自选召唤物，以及凯瑟琳的爬行号·防护单元、凛御银灰的风雪之眼；公开镜像没有） | 召唤物头像（菱形底板） |
| 官方战斗特效（0.3.0「官方特效」：普攻、弹道、命中、状态、阵亡、部署和技能；`extract.py --only fx --fx-set used` 单独提取，约 8800 个文件、磁盘约 190 MB，清单是 `data/local-fx.json`；完整包附带一份，精简包和源码需要本机提取） | 本作自己绘制的特效，设置里不显示「官方特效」 |

表情（6 套 × 6 个）和「玩法说明」的 19 页教程图公开镜像也有：`node tools/setup.mjs` 会和其他素材一起下载（约 21 MB），不需要客户端；有本地素材时优先显示本地的。两处的图都会被收进预载清单（本地提取的那份和镜像的那份各一条，客户端照旧本地优先）：36 张战斗表情属于第一批（对局界面要用），19 页「玩法说明」属于后台批次（整屏截图，不急）。

**没有客户端的服务器**想要上表中的官方素材：从**同一版本**的完整包（[Releases](https://github.com/sganggs/Stronghold-Protocol/releases)）里，把 `public/assets/local/` 文件夹和 `data/local-assets.json`（还有官方战斗特效的清单 `data/local-fx.json`）复制到服务器项目目录下的相同位置。服务器每次请求都会重新读取这两处，不必重启，玩家刷新页面即可。一定要用与服务器代码相同版本的完整包：各版本提取的内容和清单可能不同（例如灼热 / 炽焰源石虫的模型是 0.1.0 之后才加入的，召唤物模型是 0.2.0 加入的），混用其他版本的文件会缺图或用错图。复制后 `node tools/doctor.mjs` 会显示本地素材的条目数和「3D 棋盘可用」。

**0.2.0 之前提取过的**：召唤物模型是 0.2.0 新增的提取项，旧的提取结果里没有（`node tools/setup.mjs` 会提示「缺少新版的自选召唤物模型」）。有客户端的电脑运行 `node tools/setup.mjs --local` 重新提取即可，只想补这一项也可以在提取用的 Python 环境里运行 `tools/local-extract/extract.py --only spine/token`（新文件写入 `public/assets/local/spine/token/`，清单里其他条目保持不变）。

**3D 棋盘贴图的下载量**：每位玩家进入对局时都要从开服的电脑下载 3D 棋盘的 12 张贴图。提取时会给这 12 张各写一份 WebP（颜色贴图有损、质量 95，法线和数据贴图无损），清单里列的是 WebP，同名 PNG 留在旁边给裁切工具和 setup 用。这部分下载量从约 6.7 MB 降到约 2 MB，网速慢的远程联机最明显。只有 PNG 的本地素材（例如在这一改动之前提取的）可以用提取时的 Python 环境运行 `tools/local-extract/extract.py --webp` 就地补上，只需要 Pillow，不需要客户端。

本分支素材提取与 `--webp` 转换均维护实际字节的 SHA-1 指纹；转换后同步清单、WebP 文件及保留的 PNG 到素材 CDN，并重新生成资源哈希。

**各战场的官方场景**（0.2.5 素材包，维护者 2026-10-12：可以进完整包；精简包和源码安装可以在本机下载）：官方棋盘是每个战场一个做好的场景（11 个战场，其中 9 个是沙地）。场景包只在赛季开放期间随客户端分发，赛季外的客户端里没有。仓库不存放这些官方文件。有客户端的电脑可以 `node tools/setup.mjs --scenes`（询问或强制下载并提取；`--no-scenes` 跳过）。也可以分两步：`python3 tools/local-extract/fetch_scenes.py`（从官方 CDN 下载赛季版本 `26-04-13-12-31-42_e9b560` 的 33 个场景包，共 22,801,308 字节，放进 `.cache/official-scenes/`；`--list` 只看清单不下载），再用提取环境的 Python 运行 `tools/local-extract/extract.py --only scene`（材质和贴图仍取自本机客户端；`--game` 可指定客户端目录）。没有 Python 3.8+，或 UnityPy / lz4 / Pillow 没装好时，setup 只提示并继续，3D 棋盘用金属地块。没有客户端时贴图取不出来，从同一版本的完整包复制 `public/assets/local/` 和 `data/local-assets.json`。作者估计每个场景在进对局时另下载约 2–7 MB，各场景共用贴图约 3 MB；本机没有跑过提取，完整包因此增加的解压体积没有实测。

**「玩法说明」教程图的下载量**（0.2.6 起）：本地提取的 19 页教程图每页 1.2–1.5 MB，玩家每翻一页都要从开服的电脑下载。提取时同样给每页写一份 WebP（有损，质量 90，放大两倍对比看不出差别），清单列 WebP，PNG 留在旁边；19 页合计从约 25.6 MB 降到约 4.2 MB。看说明时只预载下一页（以前前后两页都预载）。已经提取过的同样用 `tools/local-extract/extract.py --webp` 补上。

## 7. 打包发布（维护者）

本分支打包前运行 `npm run build`，两个 ZIP 都包含现有 `public/build/`，运行时不需要 Vite。完整包同时包含本机生成的 `data/asset-hashes.json`（存在时），以支持 ZIP 资源校验；更新素材后先运行 `node tools/asset-hashes.mjs`。这些生成文件不提交源码仓库。

完整包、精简包及可选更新包 由 `tools/package.mjs` 生成，在**源码仓库**里运行（整合包里没有这个工具）：

```bash
npm run package -- --dry-run --list   # 只检查：列出每个文件和大小，不写任何文件（精简包加 --lite）
npm run package -- --out <目录>        # 完整包 Stronghold-Protocol-v<版本>.zip
npm run package:lite -- --out <目录>   # 精简包 Stronghold-Protocol-v<版本>-lite.zip
npm run package -- --update --from <旧版本的完整包>[,<…>] --out <目录>   # 更新包 Stronghold-Protocol-v<版本>-update.zip
```

完整包在打包机已经提取战场场景时带上 `public/assets/local/scene/`（`--dry-run` 摘要里的 `battlefield scenes` 一行）。还没有提取时完整包仍能打，棋盘用金属地块。要带上 11 个官方场景，先运行 `python3 tools/local-extract/fetch_scenes.py`，再用提取环境的 Python 运行 `tools/local-extract/extract.py --only scene`（或 `node tools/setup.mjs --scenes`），然后再 `npm run package`。精简包不带场景。`.cache/official-scenes/` 在拒绝名单里，不会打进任何包。`tools/local-extract/scenes.py` 和 `fetch_scenes.py` 必须先提交：打包读的是 `git ls-files`，未提交的脚本不会进玩家包。

- **打进去的**：`git ls-files` 里的 `server/`、`shared/`、`data/`、`public/`（不含 `public/dev/`）、`packs/`（随仓库提交的内容包；只在本机安装、没提交的不打进去）、`plugins/`（只允许 `README.md`、`AGENTS.md` 与 `_template/`，即使误跟踪服主插件也不打进去；服务器自己放进去的插件不会提交，也不打进去，见 [PLUGINS.md](PLUGINS.md)）、启动脚本、玩家会运行的工具（setup、vendor、fetch-assets 与 `tools/assets/`、doctor，以及 setup 调用的 `tools/local-extract/` 和 `crop-board-atlas.mjs`）、`tools/plugin.mjs`、`schemas/`、插件作者文档（`docs/PLUGINS.md`、`docs/PLUGIN-GUIDE.md`、`docs/PLUGIN-DSL.md`、`docs/PLUGIN-API.md` 与目录示例）、`test/helpers/battleHarness.js`（作者测试使用，只依赖包内的 server/shared）、服务器和 fetch-assets 读取的 4 张研究数据表（`docs/research/` 的 `03-operators`、`05-enemies`、`05-maps`、`07-assets` 四个 JSON）、`package.json` / `package-lock.json`、许可证与说明（`LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`、`README.md`、`CHANGELOG.md`）、`docs/PLAYING.md` 和本文；然后在临时目录里生成 `packs/index.json`（打进去的语言包和内容包的列表，供纯静态托管使用；服务器自己会实时列出，见 [PACKS.md](PACKS.md)），再 `npm ci --omit=dev` 装上运行依赖和 `public/vendor`（含沙箱必需的 SES / Acorn 及其浏览器文件，玩家无需另装）。完整包再加上 `data/assets.json` 列出的素材、`public/fonts`，以及本地提取的 `public/assets/local/` 和 `data/local-assets.json`。磁盘上有、清单却没列出的文件不打进去（例如 0.2.0 移出自选的焰狐龙梓兰的旧素材）。日文干员语音（`audio.voiceJp`，`public/assets/audio/voice/jp/` 的 2674 个文件，约 85 MB，zip 后约 76 MB）默认也打进完整包；`tools/package.mjs` 里的开关 `FULL_ZIP_JP_VOICE` 改成 `false` 时，完整包（以及由它比较出的更新包）不带这些文件：玩家首次启动时 setup 会像精简包那样下载它们，下载完成前选「日本語」会播中文语音，更新包也不会删除玩家已有的日文语音。英语、韩语和本土语言配音（`audio.voiceEn` / `audio.voiceKr` / `audio.voiceNative`）同样默认打进完整包（5712 个文件，约 169 MB，zip 后约 157 MB）；开关是 `FULL_ZIP_OPTIONAL_VOICE`（`tools/package.mjs`，默认 `true`）。改成 `false` 时完整包不带这些文件，玩家首次启动时 setup 再下载，下载完成前缺的那一句播中文，更新包也不会删除玩家已有的这些配音。
- **不打进去的**：`test/` 除上述作者助手外的文件、维护用的工具（数据构建、golden、botbench、i18n、导入检查、本工具等）、`scripts/make-windows-bundle.mjs`（Windows 便携包，见 [WINDOWS.md](WINDOWS.md)）、其他文档、研究笔记和 `docs/img/`、`handoff/`、`.github/`、`types/`、lint / 编辑器 / Docker 配置。和 0.1.x 的整树打包（全部跟踪文件加上 `public/assets` 的全部内容）相比，0.2.0 的完整包少了约 640 个文件、解压后小约 26 MB，zip 小约 8 MB。
- **打包前的检查**（`--dry-run` 也全部做一遍）：拒绝名单（`pv`、`review`、`.cache`、`.claude`、`.git`、`logs`、`.env`、`scripts/service.env.cmd`、`handoff`、`test` 除精确允许的作者助手外、服主自己的插件、`plugins/_dist/` / `_moved/` 等）；每个打进去的模块的相对导入、玩家用的 npm 脚本（start / setup / doctor / launch / postinstall / vendor / assets）都指向包里的文件；完整包里 `data/assets.json` 和 `data/local-assets.json` 列出的文件都在（缺了先运行 `node tools/fetch-assets.mjs`）；没有只差大小写的两个路径；包里的文件（二进制素材也查）不含个人目录路径（`/Users/…`、`C:\Users\…`、`/home/…`）或本机的账户名（运行时从系统读取；`SP_PACKAGE_SCAN_NAMES=a,b` 可以再加名字）；打进去的已跟踪文件没有未提交的改动（重新生成的 `data/assets.json` 要先提交）。有任何问题都会列出原因、以非零状态结束，不写 zip；正式打包时还会核对临时目录里的文件和计划完全一致。
- **玩家包里的脚本和文档链接**：临时目录里的 `package.json` 只留下每条 `node <文件>` 都指向包内文件、并且至少指出一个文件的脚本（`start`、`dev`、`setup`、`doctor`、`launch`、`postinstall`、`vendor`、`assets`）。`test`、`golden`、数据构建、lint、本工具等不留，避免玩家运行 `npm test` 时在没有测试文件的情况下得到「0 个测试、成功退出」。`README.md`、`CHANGELOG.md`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`、`docs/PLAYING.md`、本文、插件参考和作者指南里，指向包内没有的文件的相对链接改成该版本 GitHub 标签上的同一路径（版本号去掉末尾的 `-dev` 后加 `v`；图片用 `raw`，其余用 `blob`）；`../../releases/latest` 改为仓库的 Releases 地址。源码仓库里的这些文件仍是相对链接。
- **MANIFEST.json**：三种包的根目录都有（`npm ci` 之后写入）：除素材（`public/assets/`、`public/fonts/`、`data/assets.json`、`data/local-assets.json`，归 setup 管）以外每个文件的大小和 sha256，同一版本的三种包内容相同。`npm run doctor` 和更新包的启动检查（`server/update.js`）用它核对安装。
- **更新包**（0.2.1 起，每个版本都发）：`--from` 后面列出**此次支持升级的每个旧版本完整包**（Releases 上的 zip，或它解压出来、没动过的文件夹；逗号分隔或写多个 `--from`），例如发布 0.2.2 时 `--from Stronghold-Protocol-v0.2.0.zip,Stronghold-Protocol-v0.2.1.zip`。工具照常构建完整包的临时目录（`npm ci` 等），逐个文件（大小 + sha256）和每个旧版本比较：和任何一个旧版本不同、或旧版本没有的文件都打进去，所以一个更新包能覆盖在列出的每个版本上；旧版本有、新版本没有的文件记进 `UPDATE.json` 的 `removed`（连同各旧版本里的 sha256，玩家那边只删内容一致的文件；只差大小写的同名文件和 `.env` 之类的本机文件名不删，摘要里会列出）。旧版本必须比当前版本旧、带素材（不能是精简包或更新包）、每个版本只给一次，`--dry-run` 只读取并检查旧版本。更新包里还有新版本的 `MANIFEST.json` 和 `UPDATE.json`（适用的旧版本、文件数、字节数、文件列表和 `removed`），同样经过拒绝名单和个人信息检查；摘要列出和每个旧版本相比改动 / 新增 / 删除的文件数和更新包里各类文件的数量。发布时在 Releases 说明里写明更新包适用的版本（即 `--from` 列出的版本）。0.3.0 至少以 0.2.6 完整包为基线；新增的插件模块、Schemas、作者工具、模板、SES / Acorn 与前端库都会作为新增或改变的文件进入更新包。删除列表以实际基线比较为准，不要凭开发过程里曾出现过的页面名手写。`--keep-stage` 保留更新包目录和完整包的临时目录（`<目录>/Stronghold-Protocol-v<版本>-update/` 里的 `Stronghold-Protocol/` 和 `.full/`）。
- **需要**：已下载素材的仓库（完整包）——打包前先联网运行一次 `node tools/fetch-assets.mjs`，补齐清单计划但本机还没有的素材（清单只列出磁盘上有的文件，打包工具看不出缺了哪些；`data/assets.json` 有变化就先提交）；能访问 npm 的网络（`npm ci`）；`zip`（或 bsdtar 的 `tar`，Windows 10 起自带）；更新包还要之前各版本的完整包（工具自己读 zip，不需要 `unzip`；Releases 上可以重新下载）。`--out` 默认是系统临时目录下的 `stronghold-protocol-release`，不能在仓库里面；`--force` 覆盖已有的 zip，`--keep-stage` 保留打包用的目录供检查。

## 8. 插件：服主策略文件（0.3.0 起）

插件放在 `plugins/<id>/`（见 [PLUGINS.md](PLUGINS.md) §2）。房主在房间的「插件」面板里开关：外观插件只换画面和声音，对局仍是原版；**改变玩法的插件**（数据 / DSL，以及显式启用的脚本）让这个房间玩一套自己的内容组合，每位博士的页面都会下载并逐字节校验，对局标为「非官方」，默认不计入统计总览（PLUGINS.md §11）。

房间能用哪些插件由服主决定：在 `plugins/` 里放一个可选的 `config.json`（和服务器自己的插件一样不会提交、不会被更新覆盖）。没有这个文件、且未开启脚本执行时，就是下面的默认值：

```json
{
  "rooms": "host",
  "default": [],
  "allow": ["*"],
  "classes": { "cosmetic": true, "content": true },
  "limits": { "maxSets": 4 },
  "allowIncompatible": false
}
```

| 字段 | 含义 |
|---|---|
| `rooms` | `"host"`：房主自己选插件（默认）；`"fixed"`：每个房间都固定用 `default` 里的插件，房主不能改；`"off"`：房间只玩原版（玩家在「设置」里给自己开的外观插件不受影响，它们不会进房间） |
| `default` | 新房间一开始就开着的插件 id（默认没有：原版） |
| `allow` | 房间可以用的插件：`["*"]` 全部，或列出 id |
| `classes` | 关掉某一类：例如 `{ "content": false }` 只允许外观插件；`classes` 按项覆盖默认值：默认允许 cosmetic/content；开启 sandbox 时再默认允许 script，trusted 模式再默认允许 trusted。其他未列出的类别不允许。ui 只供个人开启，不进房间组合 |
| `limits.maxSets` | 同时运行的「改变玩法」内容组合上限（0–64，默认 4）；超过时房主会看到「本服务器同时运行的插件组合已达上限，请稍后再试」 |
| `allowIncompatible` | 为其他游戏版本制作的改变玩法插件默认不能启用；设成 `true` 时大厅放行（房间里会提示）——但目前内容组合的构建本身仍会拒绝这类插件，所以暂时还开不了（DESIGN §32.6 待办）。外观插件只提示，不拦 |
| `allowDownloadHosts` | 按地址安装时额外允许的主机（字符串数组，默认没有）。一项是主机名（任意端口），或 `主机:端口`，IPv6 写成 `[地址]` 或 `[地址]:端口`。没有通配符。点名的主机才可以不是公网地址、才可以用 443 以外的端口。目录文件自己不能往这份名单里加。这个字段不参与房间策略；写错或文件坏了就当作没有额外主机，公网 https 下载不受影响。也可以用环境变量 `SP_PLUGIN_DOWNLOAD_ALLOW`（逗号分隔），和文件里的名单一起生效 |

- 环境变量 `SP_PLUGINS=off|host|fixed` 优先于文件里的 `rooms`，例如 `SP_PLUGINS=off npm start` 临时让所有房间只玩原版。
- 文件改了不用重启：房主下一次操作时（最多每秒检查一次）按新内容生效。写错的字段保持默认值，并在服务器日志里提示一次（`[plugins] …`）。
- 用了改变玩法插件的房间，对局在单独的子进程里运行（每套内容组合一个，同一组合的房间共用）：开发机实测子进程启动约 0.2 秒，载入数据和对局代码后约占 117 MB 内存（RSS），每个的堆上限 768 MB，最多同时 4 个，空闲 10 分钟后自动结束。子进程卡死（10 秒没有心跳）、崩溃或内存用尽时，只结束这套组合的对局，房间回到大厅并提示原因，服务器和其他房间不受影响。
- `SP_MATCH_HOST=worker` 改用 worker 线程（在服务器进程里运行，不另起 Node 进程）。**公网服务器不要用**：在 Node 22 上实测，worker 线程里一次性的超大分配用尽内存时，会让**整个服务器进程**退出（`FATAL ERROR: … Allocation failed`，退出码 134），原版房间也一起断开；子进程同样的情况只结束子进程。默认就是子进程（DESIGN §32.6）。
- `http://localhost:3000/healthz` 的 `content.sets` 是当前在用的改变玩法内容组合数。
- 按地址安装（[PLUGINS.md](PLUGINS.md) §17）只接受公网 https 的 443 端口，并且必须校验 zip 的 SHA-256；服务器下载后先检查再放入 `plugins/`，不执行包里的任何代码。内网、本机、链路本地和 `.local` 默认拒绝，重定向到这些地址或离开 https 也会拒绝。一次等待包含正文，不是每一跳重新计时。服主要放行某个主机，写在上面的 `allowDownloadHosts` 或 `SP_PLUGIN_DOWNLOAD_ALLOW` 里。
- 有人反馈问题时，诊断信息里的 `content:` 一行写着房间用的内容（`MODDED cs=… plugins=…` 表示开了改变玩法的插件），问题模板也会问「是否开了插件」。插件房间的问题请先找插件作者，并尽量在原版里复现。


## 9. 脚本沙箱与 CSP（0.3.0 起）

`SP_PLUGIN_SCRIPTS=sandbox` 开启 script 类的 SES 沙箱执行，默认关闭；trusted 类遵循第 10 节的原生执行门槛，永远
不进入此沙箱。用启动脚本开服时也可以不设环境变量，直接加参数：`scripts/start.sh --scripts sandbox`、
`scripts\start-windows.bat --scripts sandbox`；Windows 上双击 `scripts\start-windows-sandbox.bat` 等于后者（参数取
`off` / `sandbox` / `trusted` / `trusted-force`，`off` 会去掉继承来的环境变量；服务器已经在运行时参数不生效，要先停止它）。此开关允许公网部署，要求有效 lock 和全部文件字节一致，但不要求 trusted pin，也不要求逐人同意
（维护者 2026-10-14 确认）。房间标「脚本（沙箱）」；同一 SDK、描述符与预算已接通，不降级执行。所有玩法插件的浏览器战斗都在专用 Worker 中，卡死看门狗默认 2 秒。
首次应用未缓存的脚本时，每个插件的注册探测默认最多 5 秒，大厅（含原版房间）可能短暂停顿；`SP_SCRIPT_PROBE_MS` 可设为 500–60000 毫秒，慢机器可提高。成功与失败都会缓存，文件或设置变了需重新探测。
沙箱脚本服务器宿主强制子进程，忽略 `SP_MATCH_HOST=worker`；Node 22 `--permission` 只开放安装目录读取，没有写文件、
起子进程、起线程或原生扩展权限，通过 JSON IPC 收取内容，保留现有内存上限和心跳看门狗。

Node 22 权限模型不是恶意代码安全边界，且不限制网络。SES/V8 逃逸后仍可能访问内网、安装目录和已打开的文件描述符；
安装目录内指向外部的符号链接可能扩大可见范围，也可能被 Node 的真实路径权限检查拒绝。`node_modules` 必须实际装在安装目录里，不要链接到外部目录，否则沙箱可能无法加载 SES / Acorn。建议用低权限用户，最好部署在限制出站/内网访问、内存与 CPU 的容器中
[ASSUMED]。不要把启用沙箱等同于可以安全运行任何来源的插件。官方说明见
[Node 22 permissions](https://nodejs.org/docs/latest-v22.x/api/permissions.html)。

本分支不发送整站、模拟 Worker、界面插件或工作台的 CSP 响应头，不再使用 `SP_CSP` 开关或 Pixi no-eval 适配器。
保留 iframe `sandbox="allow-scripts"`（无 allow-same-origin）、SES、Node 权限、插件内容字节校验和工作台密钥/本机网络访问限制；
工作台仍发送 X-Frame-Options: DENY，其他响应仍有 nosniff 和 Referrer-Policy。
移除 CSP 后不再保证 Worker 的网络被浏览器策略阻断；直接顶层打开插件页面也不再具有 iframe 的 opaque-origin 隔离。
只安装可信插件，脚本默认关闭；沙箱不能替代低权限用户、容器和出站网络限制。反向代理如另设 CSP，由部署者独立管理。

## 10. Trusted script plugins（原生受信任执行，实验接口）

Scripts are off by default. After reviewing every file, pack the plugin and set `SP_PLUGIN_SCRIPTS=trusted`.
In `plugins/config.json`, add `"trusted": { "<id>": "<SHA-256 of plugin.lock.json>" }`. The exact lock and every
file must match; repack and repin after edits. The catalogue still lists disabled scripts with a refusal reason.

Bind to an explicit loopback or private LAN IP. Public addresses and wildcard listeners (`0.0.0.0`, `::`) refuse
trusted code; `SP_PLUGIN_SCRIPTS=trusted-force` explicitly overrides this [ASSUMED name]. The check uses the listening
address, never a request's address. If a public reverse proxy fronts the server, make the same public-deployment
`trusted-force` decision even when the listener is on a loopback address. Existing room class/allow policy still applies.
All numeric spellings of IPv6 zero, IPv4 0/8 and IPv4-mapped equivalents are refused;
the actual address returned after binding is checked again, and any refused trusted service is killed and reaped.

This executes native third-party code: it can control a player's whole game page, and server code can access the
server account's files and network. The lexical “sandboxable” label is not isolation. Every seated player must accept
the current content hash before starting; a red banner stays visible. Unconsenting spectators receive data/snapshots
only. Infinite loops in the page are not stopped by P3a's action budget. Use only code all participants trust.

Gameplay code always runs in a match child, including bots and SP_VERIFY; it never runs in the main server.
Experimental trusted server entries use a separate child and become active at startup. Restart to change/revoke those
entries; end an active match to revoke its already pinned snapshot. Activation/request timeouts (5 s), startup failures
and shutdown use SIGKILL and wait for that child to exit. Its 128 MB old-space heap limit is not a total memory or
subprocess sandbox. Health extensions are limited to 16 KiB of UTF-8 JSON per plugin.

Composition keeps the synchronous C1 interface: an uncached registration probe pauses the lobby for up to 5 s per
plugin (`SP_SCRIPT_PROBE_MS`, 500–60000: raise it on a slow machine, where starting the engine and SES takes longer),
including vanilla rooms — once per plugin version and settings, since results are cached. Probes use SIGKILL and cache successes/failures by plugin, lock, source descriptor and
settings (256 recent results). The explicit local `node tools/plugin.mjs test <id>` command authorizes execution
without server mode or trusted-pin checks; it is not evidence that those files match the production pin.
Full SDK, pinning, consent and limitations:
[PLUGINS §13](PLUGINS.md#13-scripts-p3a).

Node 22 的 `--permission` **不限制网络**（TCP/UDP/DNS/监听均可能可用）。安装根内指向外部的符号链接也会
扩大可读范围：不要在安装根中放此类链接，包括外链 node_modules、npm link 和配置/存储链接。建议使用容器或
网络命名空间限制出站与内网访问，并设置 OS 内存/CPU 限额。父进程已对日志、启动错误、发送帧、RPC 回复等 IPC
做形态和长度复核（DESIGN §32.11），但 Node 在复核前已解码 IPC，不能据此声称免疫内存炸弹或消息洪泛。
