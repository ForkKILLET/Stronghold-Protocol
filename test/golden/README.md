# Golden results

## 2026-11-11 三期多人终极模拟 5＋5 禁用数量

依据用户提供的官服盟约页截图，并由用户确认模式为多人终极模拟，只将三期 `mode_multi_abyss`
的附加盟约禁用数由 4 改为 5。核心仍按 10 个候选抽取一半；其它模式的数量及悬赏规则不变。
以 `e53af020` 为对照，完整比较三期 14 场 matches，只有以下 3 场变化，其余 11 场逐字段一致；
全部场景地图、Boss、隐藏 Boss、敌方阵营及策略选择不变，引擎／模拟／分发／日志错误均为零。

| 场景 | 首回合差异及原因 |
|---|---|
| `coop3-ABYSS-5` | 三位玩家阵容摘要，ai_0／ai_2 的盟约和层数；新增禁用改变可用池 |
| `coop4-ABYSS-7` | ai_0 阵容及灵巧盟约摘要；新增禁用改变可用池 |
| `coop2-ABYSS-10-boosted` | ai_1 阵容与盟约摘要，击败数 4→3、漏怪 0→1；新增禁用改变可用池 |

后续库存、抽取、AI 和战斗连锁变化保留，仅通过生成器更新这 3 场基线，不更新其它家族或旧赛季。
32 个种子的 5＋5、其它模式数量隔离及核心优先禁用规则由 `test/match/bond-groups.test.js` 覆盖。

## 2026-11-11 伊桑售出奖励修正

以 `35157cc7` 为对照，仅修正 `SERVER_MOST_BOND` 售出分支：跳过没有所属成员的全体精锐计数、
限制当前商店等级并排除售出者自身。三期 matches 的 14 场正序／逆序各运行一次，确定性完全一致，
引擎／模拟／分发／日志错误均为零。地图、Boss、隐藏 Boss 及敌方阵营 setup 全部不变。

唯一变化场景 `coop2-NORMAL-3` 从第 11 回合开始：奖励候选修正改变两位玩家的阵容与盟约，
该回合 ai_1 击败数 17→24、漏怪 12→5，后续库存、AI 决策与随机流随之分歧。
最终仍为通过 13 回合后失败，Boss 剩余生命 1,050,196→725,718。
其余 13 场逐字段不变，不更新其它家族或旧赛季基线。伊桑普通／精锐、等级上限、自身副本及缺货边界
由 `test/garrisons/regulation.test.js` 定向覆盖；旧版余不限等级及可抽取自身由 `test/content/garrisons_meta.test.js` 验证。

## 2026-11-11 三期核心优先禁用修正

先前把“任一核心被禁用”与“全部附加盟约被禁用”作 OR，误禁有可用核心的干员。
现改为有核心时仅检查核心全禁，无核心时才检查附加盟约全禁；商店、奖励、自选库存共用此判定。
可用干员增加也改变 `bondLive` 及策略候选，因此部分场景在第一回合先表现为策略初始生命值或资金变化。
以 `1198548d` 为对照，只更新三期 matches；14 场正序／逆序各运行一次，结果完全一致，
引擎／模拟／分发／日志错误均为零。地图、Boss、隐藏 Boss 和敌方阵营的 setup 逐字段不变。
以下 14 场均从第 1 回合开始分歧，其后抽取、阵容、战斗和 RNG 的连锁变化一并保留；未修改其它赛季或家族基线。

| 场景 | 首回合变化 |
|---|---|
| `solo-FUNNY-1` | 阵容／装备摘要、盟约摘要 |
| `solo-FUNNY-2` | 阵容／装备摘要、盟约摘要、部署人数、资金消费、目标生命值；策略候选变化（ai_0: band_upgrade → band_fund） |
| `coop2-NORMAL-3` | 目标生命值；策略候选变化（ai_0: band_ioleta → band_survive） |
| `coop2-HARD-4` | 目标生命值；策略候选变化（ai_1: band_cannot → band_rich） |
| `coop3-ABYSS-5` | 目标生命值；策略候选变化（ai_0: band_price → band_dance, ai_1: band_emperor → band_qalaisa, ai_2: band_evolve → band_shield） |
| `coop4-FUNNY-6` | 阵容／装备摘要、盟约摘要 |
| `coop4-ABYSS-7` | 目标生命值；策略候选变化（ai_1: band_shield → band_smith, ai_3: band_protect → band_ducklord） |
| `coop2-NORMAL-8-serverrun` | 阵容／装备摘要、盟约摘要、部署人数、资金消费、目标生命值；策略候选变化（ai_0: band_fund → band_protect） |
| `coop2-ABYSS-10-boosted` | 资金消费；策略候选变化（ai_1: band_fund → band_protect） |
| `coop2-NORMAL-14-standins` | 阵容／装备摘要、盟约摘要、目标生命值；策略候选变化（h_0: band_ursus → band_lethania） |
| `coop2-NORMAL-70-diy` | 阵容／装备摘要、盟约摘要、部署人数、击败数、漏怪数、目标生命值；策略候选变化（h_0: band_breakaway → band_mess, ai_0: band_yan → band_clementia） |
| `coop2-NORMAL-1-coverage-standins` | 阵容／装备摘要、盟约摘要 |
| `coop2-NORMAL-5-coverage-diy` | 阵容／装备摘要、击败数、漏怪数、目标生命值；策略候选变化（h_0: band_emperor → band_qalaisa, ai_0: band_evolve → band_shield） |
| `coop2-NORMAL-1-unowned-roster` | 阵容／装备摘要、盟约摘要 |

## 2026-11-11 三期本分支整局基线

三期 `matches.json` 原样来自主线 `54d24b2b`（blob `c3ed8f6c`），此前合入记录已注明完整黄金比对待补。
本分支保留自己的 AI／经济规划、赠品库存和 Boss 等规则；例如 AI 仍使用原有阵容／经济规划及最高 6 级，
不包含主线后续的 5 级上限、协作候选阵容与策略权重调整，因此不能把主线 AI 的整局结果当成本分支基线。
在独立工作树按 `c528628b`、原有奖励池串行重算全部 14 场，最早分歧在第 1／2 回合的阵容或战斗结果，
引擎／模拟／分发／日志错误均为零；本次先单独记录已有行为，未改变 AI 或其它玩法实现。

相对原主线文件，变化场景为：`solo-FUNNY-1`、`solo-FUNNY-2`、`coop2-NORMAL-3`、`coop2-HARD-4`、
`coop3-ABYSS-5`、`coop4-FUNNY-6`、`coop4-ABYSS-7`、`coop2-NORMAL-8-serverrun`、
`coop2-ABYSS-10-boosted`、`coop2-NORMAL-14-standins`、`coop2-NORMAL-70-diy`、
`coop2-NORMAL-1-coverage-standins`、`coop2-NORMAL-5-coverage-diy`、`coop2-NORMAL-1-unowned-roster`。
没有增加或删除场景；此结果仅覆盖三期 matches，不代表其它版本／家族或完整 CI 已补跑。

### 三期装备奖励池修复

以上述本分支基线为对照，仅五个装备池发生数据变化；全部 14 场正序／逆序各运行一次，结果完全一致、
四类错误均为零。只有 6 场变化，另 8 场逐字段相同：

| 场景 | 最早变化回合 | 首个变化及原因 |
|---|---|---|
| `coop2-HARD-4` | 9 | 新奖励改变装备／阵容摘要和杀敌数，继而改变 LP 与后续经营 |
| `coop4-FUNNY-6` | 9 | 奖励池改变装备与盟约层数，后续 AI 选择及结果随之变化 |
| `coop4-ABYSS-7` | 10 | 特殊重锤池改变装备摘要，后续奖励和 RNG 发生分歧 |
| `coop2-NORMAL-8-serverrun` | 10 | 奖励可正确发放后本回合消费变化，后续抽取／阵容变化 |
| `coop2-NORMAL-1-coverage-standins` | 10 | 维多利亚奖励池改变两名玩家的装备摘要及后续 AI 行为 |
| `coop2-NORMAL-1-unowned-roster` | 10 | 同上，保留没有自有普通干员的补位路径 |

物品范围和推定权重见 [DATA.md §8](../../docs/DATA.md#8-choicesjson--机变-draft-data)。
实际获得凯瑟琳普通／精锐共 32 次、各池物品可达性、异客和谢拉格发放另有定向用例；
不以整局随机阵容是否碰到某位干员代替其获得行为检查。其它家族、旧版本及完整 CI 本轮未重跑。

2026-11-05：主线 dev 精选移植重算四版共 998 个场景，无删除、无模拟异常。
相对 `96ff8ab0` 的逐项差异见 [本轮审阅记录](../../docs/GOLDEN_DEV_2026-11-05.md)。

The simulation is deterministic: the same seed and inputs give the same battle and the same match, bit for bit. These
files record the exact outcome of a fixed corpus of seeded scenarios, so a change that alters gameplay — even one meant
to be a pure refactor that only reorders random draws, hook order or iteration order — fails loudly instead of slipping
through.

- `tools/golden.mjs` builds the corpus from `data/*.json` (fixed order, fixed seeds) and reduces every scenario to a
  digest. Its header documents the families and the digest fields.
- `test/golden/<family>.json` hold the digests (`roster`, `bonds`, `fields`, `matches`, `standins`, `diy`).
- `test/golden.test.js` recomputes them and compares. On a mismatch it prints the scenario, the field and old → new.

本分支的 0.1.4 基线保留模式名单只过滤干员池、不限制盟约激活的策略，以及单人 ×1、多人随存活人数缩放的 Boss 血量。
相对上游 v0.1.4，7 个 roster、20 个 Boss/隐秘核心 fields、10 个 matches 场景的记录因此变化，bonds 不变。
合并时在独立临时副本中仅还原这些本分支规则后，全部 133 个场景与上游基线一致；当前文件记录本分支规则下的结果。

2026-10-07 合并 v0.2.0 (`1303321`) 时，在独立副本仅还原 Boss 配置、盟约激活和相关 AI 策略，全部 283 个上游场景一致。
本分支基线相对该标签变化 7 个 roster、3 个 matches 和 2 个 standins；bonds、fields、diy 不变。
变化保留模式名单只限制干员池的策略，并修正该策略暴露的泡泡与“余音”互相反伤递归；受击脉冲标记为反伤，直接攻击脉冲保持原行为。
“碎铳之簧”的无来源反伤补齐 sourceless 标记；两处均有 `test/sim/feedback5-counters-any-damage.test.js` 回归用例，更新后全部场景无模拟错误。

2026-10-07 修复 #282：联防保留本回合地形和设备，逃脱模板只提供漏怪重入批次与路线。更新前完整比对确认只有 7 个 matches 改变：
`coop2-NORMAL-3`、`coop2-HARD-4`、`coop3-ABYSS-5`、`coop4-FUNNY-6`、`coop4-ABYSS-7`、`coop2-NORMAL-8-serverrun`、`coop2-NORMAL-14-standins`。
差异来自联防中保留围栏、箱子和平台后敌人的路径、伤害与漏怪变化，继而影响生命值及后续回合；其余 276 场景不变。
仅更新上述 7 个基线。回归覆盖一人/两人联防、援助者独立拆箱、所有当前地图路径可达性以及客户端/服务器模拟一致性。

## The corpus

2026-10-11 按用户要求，干员特质赠送装备改为不占用/不受共享库存限制，固定、随机、复制及休整期赠送统一生效。
完整 287 场景更新前比对，仅 `coop4-FUNNY-6` 变化：从第 11 回合起阵容摘要改变，
后续装备选择、盟约/层数和 RNG 因赠送不再占库存而变化；仍第 14 回合胜利，最终团队 LP 126 不变，
虚拟时长 128,500 → 127,000 ms，shop RNG 811 → 851。只更新这一个 matches 基线；
其他 286 场景未变，无场景删除。赠送与购买合成仅保留真实库存贡献，有独立库存、合成及持久化回归。

2026-10-11 合并 v0.2.4（`bc50cac0`）：完整 287 场景通过。相对本分支合并前，仅原有 18 个 matches
及 `diy-135`、`diy-136` 变化，新增 `coop2-NORMAL-1-coverage-standins` 和
`coop2-NORMAL-5-coverage-diy`；roster、bonds、fields、standins 记录不变。
matches 的变化来自共享干员/装备库存、库存过滤及拟态物质规则影响阵容和随机抽取，
两个 DIY 场景来自克莱门莎 S2 溅射与飞行目标触发修正（上游 §29.12）。没有移除原场景。

在独立副本中，只还原本分支 Boss 配置/人数倍率、模式盟约激活及相关 AI 规则、两处既有反伤差异，
全部 287 场景与目标标签一致。主合并副本未临时覆盖这些规则。
本分支相对该标签仍有 8 个 roster、3 个 matches、2 个 standins 不同；
这些模式盟约/AI 差异已经在独立副本验证，bonds、fields、diy 与标签一致。

2026-10-07 合并 v0.2.1（`c2a2ef7`）：在独立副本只还原本分支 Boss 配置、盟约激活及相关 AI 策略，并还原“余音”反伤防递归与“碎铳之簧”无来源反伤修复后，完整 283 场景与标签一致。当前工作树没有临时还原这些规则。

相对本次上游基线，仅更新 7 个 roster（`roster-005`、`roster-011`、`roster-017`、`roster-023`、`roster-029`、`roster-041`、`roster-047`）、3 个 matches（`solo-FUNNY-1`、`solo-FUNNY-2`、`coop4-FUNNY-6`）和 1 个 fields（`hidden-boss_10-solo`）。前两族差异来自模式名单不限制盟约激活及 AI 策略；fields 差异已在独立副本验证来自保留的“余音”反伤修复。bonds、diy 及本分支已有的 standins 基线不变；standins 相对上游仍保留此前 2 个规则差异场景。满潜能、敌人缩放、突袭和联防的新上游结果均保留。

| family | what runs |
|---|---|
| `roster` | 49 battles: every visible chess record (normal and elite) with every selectable skill and module (DESIGN §16), 12 operators per battle on a real stage (all 11 in turn) against the round's real wave three times over, every non-leader enemy kind of `data/enemies.json` as extra spawns (half of them bounties), placeable summons on the board, every equipment item, band, battle-side 机变 card and stage map card in turn, bonds from the board |
| `bonds` | 46 battles: every bond at its activation threshold (1 layer) and at its top tier (999 layers) |
| `fields` | 22 battles: every Final Assault / Hidden Core leader on a pair and a solo template (shared pool, 200 s cap) and the 联防 field with 1 and 2 helpers on the round's stage, both halves (carried HP / SP, a knocked-out operator, two leakers' enemies) |
| `matches` | Full matches in virtual time: bot-only solo and co-op, server-run combat, boosted Hidden Core runs, partially owned human rosters and a human with no NORMAL operators (AI 托管, offline; `standIns` records the fielded stand-ins per round), and human 自选 picks with 调度中心 level 5 from the first prep (`diy` records shop draws and deployed pieces). `matchScenarios()` lists every configuration. |
| `standins` | 10 battles: every NORMAL chess record (normal and elite, 110) fielded as its 补位 stand-in (`standIn: true`: the stand-in's body, backup skill / module and kit — all 17 stand-ins, every skill a chess names for them), 12 per battle by strength band, laid out by the stand-in's position on a real stage, against the round's real wave three times over plus 8 ground enemy kinds (melee stand-ins always meet an enemy), an item each, bonds from the board |
| `diy` | battles of 自选 pieces (a DIY slot with its `diy` pick, `shared/diy.js`): every owned 6★ with an operator kit (`kits/index.js OPERATOR_KITS`) in each form of tiers 5 and 6 (normal; elite with no module and with each module) under each skill, then every prototype pick with a kit at its locked selection, normal and elite, 12 per battle against the round's real wave; a new operator kit adds its scenarios (the battle count grows with the kits) |

Battles go through the production BattleSpec path (`server/sim/spec.js`, as browsers and the server's headless fields
run them); matches construct `Match` directly with a `VirtualScheduler`. Every option is explicit, so a change to a
test-harness default never moves a digest.

What a digest ignores on purpose (it does not affect gameplay): object key order, engine unit ids (snapshot ids are
renumbered by first appearance, units are named by board uid or def id), board piece uids, the order of client events
within a tick (they are counted, not hashed) and wall-clock time. Damage / healing sums are rounded to integers and HP
to 2 decimals.

`npm test` runs the fast subset: the scenarios marked `"fast": true` in the golden files, selected by `isFast` in
`tools/golden.mjs`. `GOLDEN_FULL=1` checks everything. Use the listing commands below to inspect the current corpus
and fast subset.

## Workflow

```sh
node tools/golden.mjs --list                     # list the current corpus without running it
node tools/golden.mjs --fast --list              # list only the fast subset
GOLDEN_FULL=1 node --test test/golden.test.js   # the whole corpus (≈ 20 s with 4 worker threads)
node --test test/golden.test.js                 # the fast subset
npm run golden                                  # the same comparison from the tool (all families, a short report)
npm run golden:update                           # recompute and rewrite test/golden/*.json
node tools/golden.mjs --twice                   # determinism: the corpus twice in one process, the second pass reversed
```

- **A refactor commit must never change these files.** Run `GOLDEN_FULL=1 node --test test/golden.test.js` before
  committing it. If a digest moves, the refactor changed behaviour: find out why (the first differing value of `snaps`
  says when two runs parted, in 10-game-second steps) instead of updating the files.
- **An intended gameplay change** (a fix, new content, a data rebuild): run `npm run golden:update` and commit the
  changed files together with the change, saying in the commit message which scenarios moved and why. Until the
  official versions' M1 started, `test/versions-default-guard.test.js` (G1) also pinned the sha256 of these files and
  of the default `data/*.json` as the M0 merge check (DESIGN §35.22.2); M1 deleted it (§35.23), so these files and
  `test/golden.test.js` are the only pin again.
- **Reviewing the diff:** every scenario is a block of its own and every unit / enemy / round is one line, so a diff
  shows which scenarios moved and which values changed. A change confined to the scenarios that contain the touched
  operator, enemy or rule is expected; a change everywhere (every `rngDraws`, every `snaps`) means something global
  moved — the RNG draw order, the tick order, a shared rule.
- **Adding to the corpus** (a new family, more scenarios, a new digest field) changes the files by design: do it in a
  commit of its own, never together with a refactor.
- A new engine hook, event or chess record does not change the digests of the existing scenarios by itself — the
  hook list is frozen in the tool and the corpus is regenerated only on `golden:update` — but new data records do join
  the corpus there (the roster family enumerates `data/chess.json`).

After the measured shared-stock update (DESIGN §29.8), the original stand-in / DIY seeds remain as outcome regressions even when they field no such operator. Companion seeds `coop2-NORMAL-1-coverage-standins` and `coop2-NORMAL-5-coverage-diy` exercise those full paths; the corpus now contains 287 scenarios.

## 2026-10-12 merge of v0.2.5

Target tag: `cf7a9400270d5aa79b2e601e405dab782e25f120`; no commits after the tag.
The title-footer repository link is excluded, without removing server-about links.
Branch gift provenance, bond activation/AI policy, Boss settings, reflection fixes and backend ownership remain.
The user subsequently included the upstream board/scene WebP conversion; it does not affect simulation digests.

An independent copy reversed only these documented gameplay differences (including stock-backed console merges),
retained the merged Worker/scheduling implementation and used the tag's unchanged golden harness and data.
All 287 scenarios matched the tag (49 roster, 46 bonds, 22 fields, 20 matches, 10 standins, 140 diy).
No branch rules were temporarily overwritten in the working tree. Only after that check were the branch digests regenerated.

Changes relative to the previous branch HEAD:

| family | changed scenarios | reason |
|---|---|---|
| roster (23) | `roster-004`, `roster-005`, `roster-007`, `roster-009`, `roster-011`, `roster-012`, `roster-013`, `roster-017`, `roster-019`, `roster-023`, `roster-024`, `roster-026`, `roster-028`, `roster-032`, `roster-033`, `roster-034`, `roster-036`, `roster-038`, `roster-039`, `roster-040`, `roster-043`, `roster-046`, `roster-047` | 0.2.5 funnels, Rockrock locks, Vulpis first hit, targeting and damage-proc fixes interact with existing branch bond rules |
| bonds (12) | `bond-deputShip-low`, `bond-emptyShip-low`, `bond-kjeragShip-high`, `bond-maniShip-low`, `bond-maniShip-high`, `bond-miraShip-low`, `bond-sargonShip-high`, `bond-soloShip-low`, `bond-victoriaShip-low`, `bond-victoriaShip-high`, `bond-visiShip-low`, `bond-yanShip-low` | 0.2.5 damage-time procs, skill follow-ups, carried HP and target eligibility |
| fields (8) | `boss-boss_2-pair`, `boss-boss_3-pair`, `boss-boss_5-pair`, `boss-boss_5-solo`, `boss-boss_7-pair`, `hidden-boss_8-pair`, `hidden-boss_9-pair`, `hidden-boss_9-solo` | 0.2.5 damage-time procs, targeting/funnel fixes and exact carry-state ratios |
| matches (18) | `solo-FUNNY-1`, `solo-FUNNY-2`, `solo-NORMAL-1`, `solo-NORMAL-2`, `solo-HARD-1`, `solo-ABYSS-1`, `coop2-NORMAL-3`, `coop2-HARD-4`, `coop3-ABYSS-5`, `coop4-FUNNY-6`, `coop4-ABYSS-7`, `coop2-NORMAL-8-serverrun`, `solo-HARD-9-boosted`, `coop2-ABYSS-10-boosted`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy` | random boss pairing, displayed operator overdraw, Touch retention, DIY promotion offers, measured subsets and AI cooperation; branch gifts/bonds remain |
| standins (3) | `standin-04`, `standin-06`, `standin-07` | 0.2.5 damage-proc, attack-target and hit-tile changes |
| diy (2) | `diy-098`, `diy-099` | Goldenglow in both forms: the 0.2.5 funnel own-hit and redeployment multiplier changes |

The scenario set is unchanged. Relative to the tag, the preserved branch differences are:

- roster: `roster-005`, `roster-011`, `roster-017`, `roster-023`, `roster-029`, `roster-035`, `roster-041`, `roster-047`.
- bonds: identical.
- fields: identical.
- matches: `solo-FUNNY-1`, `solo-FUNNY-2`, `coop4-FUNNY-6`.
- standins: `standin-03`, `standin-09`.
- diy: identical.

The 8 roster / 3 matches / 2 standins differences have the same scenario identities as the v0.2.4 branch comparison;
bonds, fields and diy match v0.2.5. The independent rule-reversal comparison validates their attribution, not browser/Docker deployment.
Built-vs-Node checks now additionally cover both Rockrock/Kjera/Vulpis forms, comparing results, final snapshots and events.
The original stand-in / DIY seeds remain as outcome regressions even when they field no such operator. The
`coop2-NORMAL-1-unowned-roster` scenario supplies no owned NORMAL operators, so stand-in coverage does not depend on
the bot choosing one of a small set of missing operators. `coop2-NORMAL-5-coverage-diy` covers the DIY path.

## 2026-10-16 merge of v0.3.0

Target tag: `c24e17eec3af1e6dedfa9935a6d15245cf2f4586`; previous branch HEAD: `dbc1ddb5`.
Both the merged branch and the tag now have 288 scenarios (49 roster, 46 bonds, 22 fields, 21 matches,
10 standins, 140 diy). The tag includes `coop2-NORMAL-1-unowned-roster`; it was also already present on this branch.
No new scenarios are added merely to make the comparison pass.

The independent `.cache/merge030/upstream-rules` copy reverses only documented branch gameplay differences:
Boss HP scaling, mode bond activation and AI policy, equipment gift / console provenance, and retained reflection
fixes. It retains the merged Worker / scheduling implementation and uses the tag's unchanged harness and corpus.
After correcting the independent harness integration, all 288 scenarios match the tag (`upstream-matches3.log`).
The branch's complete golden comparison also matches its checked-in baselines (`golden-final.log`).

Changes relative to the previous branch HEAD, reviewed by scenario id:

| family | changed scenarios | reason |
|---|---|---|
| roster (49/49) | `roster-001` through `roster-049` | upstream combat timing, hit / collision, targeting, kit and event changes across the full operator mix |
| bonds (45/46) | every bond scenario except `bond-yanShip-high` | upstream combat / proc changes exercised at bond thresholds; all results match the tag |
| fields (22/22) | all `boss-*`, `hidden-*`, `unite-1`, `unite-2` | upstream combat, enemy and leader changes; all results match the tag |
| matches (21/21) | every match scenario in `matches.json` | upstream economy / inventory, AI rehearsal, shop and combat changes, retaining branch-specific rules |
| standins (10/10) | `standin-01` through `standin-10` | upstream combat and kit changes across both forms and their stand-ins |
| diy (136/140) | every DIY scenario except `diy-010`, `diy-012`, `diy-093`, `diy-134` | upstream combat and selected kit / module changes; all results match the tag |

Broad movement is not treated as refactor noise or approved solely by regenerating baselines: the independent
rule-reversal check above is the evidence separating upstream changes from preserved branch differences.
Relative to the tag, the remaining branch differences are exactly:

- roster: `roster-005`, `roster-011`, `roster-017`, `roster-023`, `roster-029`, `roster-035`, `roster-041`, `roster-047`.
- matches: `solo-FUNNY-1`, `solo-FUNNY-2`, `coop4-FUNNY-6`.
- standins: `standin-03`, `standin-09`.
- bonds, fields and diy: identical.

These 8 / 3 / 2 scenario identities are unchanged from the preceding branch-to-tag comparison. This evidence
does not validate browser rendering, Docker deployment, or cross-version recovery of live matches.

Historical versions (0.3.2 M2): pass `--version <official-id>` to use the snapshot in an isolated process/worker.
The six corpora live under `<versionSlug>/`; root JSON files remain the default. Generate a historical corpus with
`node tools/golden.mjs --version act1autochess --update --twice`; the second pass reverses scenario order.
`test/versions-golden.test.js` checks corpus identity, engine errors and representative worker execution.

## 2026-11-05 主线 v0.3.3 对齐

本分支继续保留模式不完整盟约仅过滤干员池、仍可激活盟约，以及特质赠送装备不占库存、Boss 按存活人数缩放的已记录规则。合入主线新玩法、AI 与隐秘核心重新配对后，重新核对 7 个 FUNNY roster、2 个 FUNNY stand-in 和 4 场完整对局的摘要；这些场景与主线基准存在上述明确规则差异，且引擎、调度、模拟和分发错误均为零。其余家族与场景保留合入后的基准，并通过比较验证。不能将本分支摘要作为主线原版规则的摘要。
