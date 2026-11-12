# 三期评语与跨组查看调查（2026-11-12）

## 证据与边界

- 固定官方表镜像：[Kengxxiao 6f63c14e activity_table.json](https://github.com/Kengxxiao/ArknightsGameData/blob/6f63c14e27b847ef74b53b00fe51fc322b3cd7ff/zh_CN/gamedata/excel/activity_table.json)，`activity.AUTOCHESS.act3autochess.V3_1.playerTitleDataDict`。
- [PRTS 规程：联合成就奖杯与成就](https://prts.wiki/w/卫戍协议·规程#联合成就奖杯与成就) 说明六维的含义及称号归属。
- 当前本机原版 PC metadata 的 `ActAutoChessPlayerTitleData` 同样仅含 `id/type/point/rank/picId/txt`；结算 UI 读取服务器结果，未找到授予阈值。
- 阈值、同档并列、优先级、每人可获数量、特殊称号条件均未确认。`rank` 是表中的档位标记，不据此推断为队内名次；`point` 为原字段，不据此反推统计图公式。

## 三期的六类、18 种称号

| type／维度 | 已确认的含义 | 特殊（rank 0） | rank 1 | rank 2 |
| --- | --- | --- | --- | --- |
| BOND／盟约理解 | 盟约层数和种类的掌控 | 百花齐放（comment_1） | 坚实盟约（comment_2） | 不朽盟约（comment_3） |
| KILL／补救能力 | 联防阶段为盟友拦截敌人 | 救火队长（comment_4） | 可靠后盾（comment_5） | 力挽狂澜（comment_6） |
| EQUIP／装备活用 | 获得与使用装备 | 精挑细选（comment_7） | 有备无患（comment_8） | 万事俱备（comment_9） |
| COIN／资金管理 | 获取与利用资金 | 富贵浮云（comment_10） | 一掷百金（comment_11） | 挥金如土（comment_12） |
| CHAR／人力调度 | 干员精锐化 | 孤胆先锋（comment_13） | 汇聚人才（comment_14） | 精英云集（comment_15） |
| DAMAGE／领袖挑战 | 对领袖造成杀伤 | 幕后领袖（comment_16） | 中流砥柱（comment_17） | 绝对核心（comment_18） |

各组三条的 point 分别为 0、1、1。旧版 comment_N 的语义不适用于三期。例如 comment_4 在二期为「精英云集」，在三期为「救火队长」。原生成器错误套用二期 stat/rule/text；旧 tuning 还把三期「不朽盟约」改为生命损失最少。后十二个称号既无条件也无说明。

## 当前决定：暂用二期六种评语

用户随后要求「先回退二期 6 种评语，推送并部署」，替代上一轮显示六类 18 种并暂停发放的方案。18 种定义及待补证信息保留在上表。

三期 profile 显式设置 titlesFrom=act2autochess，生成器从二期固定官方表读取完整六种名称、图标，复用其说明、现有发放算法及 tuning；成就图与收藏家恢复六种语义。当前使用：卫戍之星、不朽盟约、坚若磐石、精英云集、万事俱备、挥金如土。包括「生命损失最少」修正，不保留暂停发放标记。

这是本服暂行规则，不声称二期算法等于三期官服。其它三期玩法、房间版本与既有历史记录不改写；新称号条件补齐后再跟进。

## Boss 战场查看

- 主线 dev 固定审阅 `f8a6619b3edaaa26c8ad61b730ad7c8475b7310d`：服务端 `watch/_watchClient`、客户端 `observeTarget/watchTarget` 均保留跨 Boss 组限制。
- 依据来自 2026-09-28 的 [早期研究](../../09-ux-official.md)：「两名参与者会处于同一个战场，但无法查看另一组队友的战场情况」。这是旧玩法规则复刻，未发现必须禁止的运行时技术原因。
- 本分支 `edfd4de3`（2026-10-12）仅开放普通战斗及联防保留战场，明确保留 Boss 限制；并非后续合入导致回归。
- 用户确认现在官服支持另一组查看，并授权跟进；本次不推断官服更新日期或适用赛季历史。

前后端同时开放最终攻势／隐秘核心现存战场的查看。自身战斗与模拟权限继续独立，另一组为显示副本，支持返回和重连恢复。组内的左右／全景仍仅为镜头选择。淘汰队友和不存在的战场继续拒绝，已有观战者规则不变。

## 验证状态

三期回退数据由固定缓存经生成器重建，并重建独立术语；均经 check:local --small。测试与浏览器复验继续按用户要求暂缓。准备了跨组查看／重连及六种评语完整回退、恢复发放用例，不引用旧轮次测试充当本轮结果。

三期 golden 30 处称号的名称／图标／说明按二期目录机械同步，既有 ID 与全部模拟字段保持原样；未重新计算模拟，不计为 golden 验证通过。
