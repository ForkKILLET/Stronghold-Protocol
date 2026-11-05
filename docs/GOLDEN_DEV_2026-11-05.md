# dev 精选移植：黄金场景差异（2026-11-05）

由单任务 `golden.mjs --jobs 1 --update` 生成四版基准，再对迁移前 `96ff8ab0` 审阅。
本表列出每个变化/新增编号；完整值及实际变化字段在同次提交的 JSON 中。没有删减场景；所有场景的模拟错误数须为零。

## 第二期下半

- **bonds**：共 46 个，变化 2 个，新增 0 个。 共用战斗修正影响相关盟约阵容的伤害、存活和事件。
  - 变化：`bond-investShip-high`, `bond-skillfulShip-high`。
- **diy**：共 143 个，变化 7 个，新增 3 个。 技能修正及新增 kit/模组；第一期还包括敌人时序。新 kit 插入使尾部原型分组重新编号，原覆盖继续保留。
  - 变化：`diy-038`, `diy-058`, `diy-136`, `diy-137`, `diy-138`, `diy-139`, `diy-140`。
  - 新增：`diy-141`, `diy-142`, `diy-143`。
- **fields**：共 22 个，变化 6 个，新增 0 个。 圣杯分摊和持续施法/移动修正影响首领场的生命、单位及快照；保留本服 Boss 血量规则。
  - 变化：`boss-boss_1-solo`, `boss-boss_2-pair`, `boss-boss_2-solo`, `boss-boss_3-solo`, `boss-boss_5-solo`, `hidden-boss_9-solo`。
- **matches**：共 21 个，变化 6 个，新增 0 个。 波次替换、共用战斗/第一期敌人时序影响经营后果和后续回合；默认 Bot 打法未改。
  - 变化：`solo-FUNNY-1`, `solo-FUNNY-2`, `solo-NORMAL-2`, `solo-HARD-2`, `solo-ABYSS-2`, `coop2-NORMAL-14-standins`。
- **roster**：共 49 个，变化 12 个，新增 0 个。 装备独立生效、移动/封护/持续施法/圣杯结算修正；第一期还包括六类敌人的动画时序修正。
  - 变化：`roster-011`, `roster-013`, `roster-014`, `roster-015`, `roster-018`, `roster-023`, `roster-034`, `roster-037`, `roster-038`, `roster-047`, `roster-048`, `roster-049`。
- **standins**：共 10 个，变化 1 个，新增 0 个。 共用敌人/战斗修正影响相应补位阵容。
  - 变化：`standin-01`。

## 第二期上半

- **bonds**：共 46 个，变化 2 个，新增 0 个。 共用战斗修正影响相关盟约阵容的伤害、存活和事件。
  - 变化：`bond-investShip-high`, `bond-skillfulShip-high`。
- **diy**：共 126 个，变化 4 个，新增 0 个。 技能修正及新增 kit/模组；第一期还包括敌人时序。新 kit 插入使尾部原型分组重新编号，原覆盖继续保留。
  - 变化：`diy-038`, `diy-058`, `diy-059`, `diy-074`。
- **fields**：共 22 个，变化 15 个，新增 0 个。 圣杯分摊和持续施法/移动修正影响首领场的生命、单位及快照；保留本服 Boss 血量规则。
  - 变化：`boss-boss_1-pair`, `boss-boss_1-solo`, `boss-boss_2-pair`, `boss-boss_2-solo`, `boss-boss_3-pair`, `boss-boss_3-solo`, `boss-boss_4-pair`, `boss-boss_5-pair`, `boss-boss_5-solo`, `boss-boss_6-pair`, `boss-boss_7-pair`, `hidden-boss_8-pair`, `hidden-boss_9-pair`, `hidden-boss_9-solo`, `hidden-boss_10-pair`。
- **matches**：共 16 个，变化 10 个，新增 0 个。 波次替换、共用战斗/第一期敌人时序影响经营后果和后续回合；默认 Bot 打法未改。
  - 变化：`solo-FUNNY-1`, `solo-FUNNY-2`, `coop2-NORMAL-3`, `coop4-FUNNY-6`, `coop2-NORMAL-8-serverrun`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-1-unowned-roster`。
- **roster**：共 49 个，变化 16 个，新增 0 个。 装备独立生效、移动/封护/持续施法/圣杯结算修正；第一期还包括六类敌人的动画时序修正。
  - 变化：`roster-005`, `roster-010`, `roster-011`, `roster-013`, `roster-015`, `roster-017`, `roster-020`, `roster-023`, `roster-029`, `roster-033`, `roster-035`, `roster-039`, `roster-041`, `roster-046`, `roster-047`, `roster-049`。
- **standins**：共 10 个，变化 2 个，新增 0 个。 共用敌人/战斗修正影响相应补位阵容。
  - 变化：`standin-03`, `standin-09`。

## 第一期下半

- **bonds**：共 36 个，变化 4 个，新增 0 个。 共用战斗修正影响相关盟约阵容的伤害、存活和事件。
  - 变化：`bond-deputShip-low`, `bond-kjeragShip-high`, `bond-skillfulShip-high`, `bond-swiftShip-low`。
- **diy**：共 95 个，变化 11 个，新增 0 个。 技能修正及新增 kit/模组；第一期还包括敌人时序。新 kit 插入使尾部原型分组重新编号，原覆盖继续保留。
  - 变化：`diy-001`, `diy-004`, `diy-006`, `diy-026`, `diy-027`, `diy-035`, `diy-036`, `diy-069`, `diy-075`, `diy-079`, `diy-084`。
- **fields**：共 20 个，变化 13 个，新增 0 个。 圣杯分摊和持续施法/移动修正影响首领场的生命、单位及快照；保留本服 Boss 血量规则。
  - 变化：`boss-boss_1-pair`, `boss-boss_1-solo`, `boss-boss_2-pair`, `boss-boss_2-solo`, `boss-boss_3-pair`, `boss-boss_4-pair`, `boss-boss_6-pair`, `boss-boss_7-pair`, `boss-boss_7-solo`, `hidden-boss_8-pair`, `hidden-boss_9-pair`, `hidden-boss_10-pair`, `unite-2`。
- **matches**：共 16 个，变化 12 个，新增 0 个。 波次替换、共用战斗/第一期敌人时序影响经营后果和后续回合；默认 Bot 打法未改。
  - 变化：`solo-FUNNY-1`, `solo-FUNNY-2`, `solo-HARD-2`, `coop2-NORMAL-3`, `coop2-HARD-4`, `coop4-FUNNY-6`, `coop2-NORMAL-8-serverrun`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-1-unowned-roster`。
- **roster**：共 41 个，变化 18 个，新增 0 个。 装备独立生效、移动/封护/持续施法/圣杯结算修正；第一期还包括六类敌人的动画时序修正。
  - 变化：`roster-005`, `roster-006`, `roster-007`, `roster-008`, `roster-009`, `roster-011`, `roster-013`, `roster-014`, `roster-016`, `roster-018`, `roster-019`, `roster-023`, `roster-027`, `roster-029`, `roster-033`, `roster-034`, `roster-035`, `roster-036`。
- **standins**：共 12 个，变化 6 个，新增 0 个。 共用敌人/战斗修正影响相应补位阵容。
  - 变化：`standin-01`, `standin-03`, `standin-04`, `standin-09`, `standin-10`, `standin-12`。

## 第一期上半

- **bonds**：共 36 个，变化 4 个，新增 0 个。 共用战斗修正影响相关盟约阵容的伤害、存活和事件。
  - 变化：`bond-deputShip-low`, `bond-kjeragShip-high`, `bond-skillfulShip-high`, `bond-swiftShip-low`。
- **diy**：共 93 个，变化 15 个，新增 0 个。 技能修正及新增 kit/模组；第一期还包括敌人时序。新 kit 插入使尾部原型分组重新编号，原覆盖继续保留。
  - 变化：`diy-001`, `diy-004`, `diy-006`, `diy-026`, `diy-027`, `diy-035`, `diy-036`, `diy-065`, `diy-069`, `diy-074`, `diy-075`, `diy-079`, `diy-085`, `diy-087`, `diy-091`。
- **fields**：共 20 个，变化 13 个，新增 0 个。 圣杯分摊和持续施法/移动修正影响首领场的生命、单位及快照；保留本服 Boss 血量规则。
  - 变化：`boss-boss_1-pair`, `boss-boss_1-solo`, `boss-boss_2-pair`, `boss-boss_2-solo`, `boss-boss_3-pair`, `boss-boss_4-pair`, `boss-boss_6-pair`, `boss-boss_7-pair`, `boss-boss_7-solo`, `hidden-boss_8-pair`, `hidden-boss_9-pair`, `hidden-boss_10-pair`, `unite-2`。
- **matches**：共 16 个，变化 12 个，新增 0 个。 波次替换、共用战斗/第一期敌人时序影响经营后果和后续回合；默认 Bot 打法未改。
  - 变化：`solo-FUNNY-1`, `solo-FUNNY-2`, `solo-HARD-2`, `coop2-NORMAL-3`, `coop2-HARD-4`, `coop4-FUNNY-6`, `coop2-NORMAL-8-serverrun`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-1-unowned-roster`。
- **roster**：共 41 个，变化 18 个，新增 0 个。 装备独立生效、移动/封护/持续施法/圣杯结算修正；第一期还包括六类敌人的动画时序修正。
  - 变化：`roster-005`, `roster-006`, `roster-007`, `roster-008`, `roster-009`, `roster-011`, `roster-013`, `roster-014`, `roster-016`, `roster-018`, `roster-019`, `roster-023`, `roster-027`, `roster-029`, `roster-033`, `roster-034`, `roster-035`, `roster-036`。
- **standins**：共 12 个，变化 6 个，新增 0 个。 共用敌人/战斗修正影响相应补位阵容。
  - 变化：`standin-01`, `standin-03`, `standin-04`, `standin-09`, `standin-10`, `standin-12`。
