# 本机测试与内存隔离

本机 Linux 的 `npm test` 自动进入独立 systemd scope。其他重型命令使用同一个入口：

```sh
npm run check:local -- node --test --test-concurrency=1 test/users/versions.test.js
npm run check:local -- node tools/golden.mjs --jobs 1
npm run check:local -- npm run build
SP_E2E=1 SP_E2E_BUILD=1 npm run check:local -- node --test --test-concurrency=1 test/ui/mobile-management.e2e.test.js
```

定向检查可在入口后加 `--small`，收窄为 MemoryHigh=3 GiB、MemoryMax=4 GiB、swap 256 MiB、Node 堆 1 GiB，启动要求降为至少 6 GiB 可用内存；这是更低的任务预算，不是取消保护。

必须顺序执行这些命令。不要同时跑全量测试、golden、浏览器与构建；不要用没有文件列表的 `node --test`，它会执行 helpers 和 fixtures。测试范围优先由实际修改和失败文件确定，已有通过的长跑不因换一轮对话而重复执行。

`test/golden.test.js` 和历史版本 golden 子进程在本机限额环境中固定单 Worker；即使设置 `GOLDEN_JOBS` 也不会扩大本机并发。直接运行工具仍须显式传 `--jobs 1`，CI 保留原设置。

`tools/local-check.sh` 不需要 sudo，要求 Linux、当前用户的 systemd manager、flock 和有效的 XDG_RUNTIME_DIR。无法建立隔离时直接失败，不回退到无限额执行。

| 限制 | 默认值 |
| --- | --- |
| 整个任务及所有子进程 MemoryHigh | 6 GiB |
| MemoryMax | 8 GiB |
| MemorySwapMax | 512 MiB |
| Node V8 堆 | 2 GiB / 进程 |
| TasksMax | 256 |
| 启动前 MemAvailable | 至少 10 GiB |
| 本机测试文件并行 | 1 |

所有工作树共用 `/run/user/<uid>/stronghold-protocol-check.lock`，防止本仓库的重任务叠跑。进程进入 `sp-local-check-*.scope`，离开 Paseo/编辑器的进程组；OOMPolicy=kill 使 scope 内的 OOM 终止该任务组。不要移除限制来重试超限测试；先检查泄漏、报告缓冲、Worker 数量或夹具规模。

浏览器也可能触及 `TasksMax=256`（`pthread_create` / `Target closed`，但 memory.events 没有 OOM）。先减少浏览器实例，使用隔离账户上下文；软件渲染可设 `LP_NUM_THREADS=2` 并通过 `taskset` 收窄到允许的两个 CPU。保持原线程和内存上限，不靠扩大预算掩盖失败。

CI 仍按既有分片策略运行；本机不要通过设置 CI 环境变量绕过隔离。跨平台功能测试本身仍保留 Linux/Windows 支持，这个本机保护入口只针对 Linux。

2026-11-05 devops 分析记录：16:27:12 的被杀 Node 约占 22.1 GiB RAM 和 18.4 GiB swap，全机 swap 耗尽；Paseo scope 当时没有内存上限，因此被连带停止。同期有全量测试和 golden 任务，但没有保留被杀 PID 的完整命令，不能确定具体泄漏来源。任务结束时记录 memory.peak 和 memory.events；本次用小进程验证 cgroup 的 memory.high/max、swap.max、oom.group 和 V8 堆限制；不通过实际制造 OOM 验证。
