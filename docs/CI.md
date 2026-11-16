# CI（持续集成）

本 Fork 采用面向生产 Linux / Node 22 的保守配置；分片只分配文件，不减少全量测试集合。
`.github/workflows/ci.yml` 普通代码更新默认启动 **6 个任务**：

| 任务 | 数量 | 内容 |
|---|---:|---|
| `tooling` 综合检查 | 1 | Node 22：安装、setup、生产构建、服务器冒烟、lint、导入边界、类型检查；15 分钟 |
| `test` Linux 分片 | 4 | Ubuntu / Node 22，片 0–3；各自安装依赖，下载综合检查的构建产物，再运行完整集合中的对应片；40 分钟 |
| `golden` | 1 | 独立 Ubuntu / Node 22，全量 `npm run golden`；15 分钟，有差异即失败，绝不更新期望 |

生产前端仅构建一次、冒烟一次。`tooling` 成功后上传同一次运行的 `production-client`，内容为 `public/build/`，
缺文件必须失败，保留 1 天；Linux 和可选 Windows 分片都依赖该任务并下载到原路径，不共享跨平台 `node_modules`。
产物仅供这次 CI 测试使用，不向生产服务器部署。上传／下载使用官方
[upload-artifact](https://github.com/actions/upload-artifact)／[download-artifact](https://github.com/actions/download-artifact)。

自动触发限本仓库 `main` 的 push 及目标为 `main` 的 PR；普通 PR 开发分支的 push 不重复运行。
纯 Markdown／`docs/` 修改不自动触发，混合代码修改照常完整运行。`workflow_dispatch` 可在所选分支手动运行，
默认仍为六个任务；勾选 `compatibility` 后另加 Windows / Node 22 四片及 Node 24 守卫，共 **11 个任务**。
CI 守卫本身已包含于 Linux 的完整测试集合，不在综合检查中重复执行或阻止其余分片取证。Node 24 仍仅运行 `test:guards`，不代表该 Node 版本已通过完整套件。并发按事件和 ref 取消过时运行，权限保持只读。

独立 Python workflow 仅在 `tools/local-extract/**`、`tools/setup.mjs`、其守卫或 workflow 文件变化时自动触发，
也可单独手动运行；仍用 Ubuntu 24.04 / Python 3.8 编译全部提取源码，不安装提取依赖。这类改动普通 push 共 **7 个任务**。
PR／Issue 标题标签工作流保持原行为与权限，不参与普通 push。

```bash
gh workflow run ci.yml --ref main -f compatibility=true
gh workflow run local-extract-python.yml --ref main
```

本机 `npm run ci`（`node tools/ci.mjs`）按依赖顺序执行 setup、构建、冒烟、lint、导入边界、类型检查、
全量测试及单独的 CI 守卫。它不传输 artifact，也不重复 OS／Node 兼容矩阵；测试步骤仍清除继承的 `SHARD`、`JUNIT`。
`--only`、`--keep-going`、`--list` 见 [CONTRIBUTING.md](../CONTRIBUTING.md)。全量黄金仍另跑 `npm run golden`。

本次仅修改配置并验证工作流结构、定向守卫及构建／冒烟，不在本机重跑全量模拟或 golden。
在修改前提交 `007aaa4a` 和修改后均复现计权守卫的同一失败：447 个文件未计权，约占默认估算工作量 11%，超过 10% 门槛。
本次未新增测试文件、修改权重或放宽守卫；需取得新的可归属 CI 文件计时后另行更新 `ci-shards.json`。
因此不能声称本次完整 CI 已通过，也不能靠精简工作流解决该既有失败。

## 分片契约

`ci-shards.json` 保存四片的计权输入；`tools/ci-shards.mjs` 读取与 `tools/ci.mjs` 相同的 `TEST_FILES`，按权重降序依次放入最轻的一片，同权重按文件名、同负载按片号裁决。

1. 每个测试文件恰好出现一次，新增文件按 `defaultMs` 计权。
2. 最大与最小估计负载之比不超过 `MAX_IMBALANCE = 1.3`。
3. 分配不依赖时钟、网络或随机数。
4. workflow 必须列齐 `0..SHARD_COUNT-1`，每个片号一次；漏片、重复片或偏离本 Fork 的自动 Linux／手动 Windows、Node 组合会让 `test/ci.test.js` 失败。

`test/ci-shards.test.js` 检查文件覆盖、陈旧键、未测量占比和负载；`test/test-run.test.js` 检查环境到执行文件的映射。

```bash
npm run shards -- --check
node tools/ci-shards.mjs --print 0
node tools/ci-shards.mjs --run 0
SHARD=2 npm test
```

`npm test` 未设 `SHARD` 时仍跑全量；手动设置才跑指定片。`JUNIT=report.xml npm test` 可额外输出 JUnit，reporter 参数必须位于测试文件之前。CI 没有启用 JUnit 上传。

## 权重来源与更新

采用 #836 的表，不使用 #835 的旧表。来源是作者评论所报的 CI run **39617468541**：`fullmatch-coop.test.js` 中位数 **235132 ms**，Windows 片 0 墙钟 **397 s**。本轮未独立复核 GitHub run；这些是计权出处，不是本机重新测出的性能结论。文件耗时相加是估计工作量，因文件并行而不等于任务墙钟；不要拿本机耗时替换 CI 权重。

新增文件通常无需重新计权；某文件明显变慢后，从可归属到文件的 CI 报告更新：

```bash
node tools/test-timings.mjs report.xml
node tools/ci-shards.mjs --write --timings report.xml
```

解析器只接受 `<testcase file="…" time="…">`，没有 `file` 的报告拒绝计权，不从用例名猜路径。部分 Node 版本的 JUnit 不提供 `file`；应先取得带文件信息的报告，路径按 test/ 或 plugins/ 归一到仓库。多个报告取每个文件的下中位数；未出现的文件保留原权重。每次改表后重新检查最慢任务墙钟，再决定超时；40 分钟保留 runner 机型差异和负载余量。

## 改工作流

先核对目标仓库的分支与工作流，不把 fork 的分支假设写进上游。分片数、矩阵和守卫需同时更新；保留独立 Golden 与按路径触发的 Python 3.8 语法检查。不要把本 Fork 的 `main` 触发策略直接套入上游。与改动无关的失败应在报告中说明来源，不能通过缩小测试集合隐藏。
