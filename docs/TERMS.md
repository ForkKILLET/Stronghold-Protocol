# 术语说明

百科、技能、装备、盟约及战斗详情共用 RichText 的术语交互。官方 `<$ba.cold>…</>` 等标记按 ID 查询，保留嵌套样式；不按中文显示名称猜测。未提供释义时保留普通强调文字，取消虚线、点击及键盘入口。

- 鼠标悬停或键盘聚焦可预览，点击／Enter／空格及手机轻点可固定。
- 预览和固定共用相同正文结构，不显示“点击固定”提示行，切换时保持卡片高度；四边为统一细边框，字号和留白保持紧凑。
- 关联术语在同一个说明卡内切换，返回按钮回到上一个词条；不会叠出多层窗口。
- 点击外部、关闭按钮或 Escape 收起。固定时复用弹窗焦点栈；Escape 先关闭说明，再处理原百科、调配或弹窗。源词条卸载后清理浮层。
- 说明卡位于全局浮层，不受正文滚动裁剪；窗口、字体和内容尺寸改变时重新定位，超长正文使用统一滚动条。
- 词条用行内 span，不在选卡、购买等按钮内嵌套原生按钮。点击、双击及指针事件不透传为选卡或确认；原生卡片的键盘行为保留。

## 数据来源与更新

`data/terms.json` 是官方客户端 `gamedata_const.json` 的 `termDescriptionDict` 提取结果，仅保存 ID、名称和描述，不改模拟数据。本次中文源为 Kengxxiao/ArknightsGameData `bee3f83c5d60590b5e1cd42b8d09d00ce32ab10d`；外服语言来自 Kengxxiao/ArknightsGameData_YoStar，繁体中文来自 ArknightsAssets/ArknightsGamedata。每个输入的完整版本、URL 和 SHA-256 均记录在 [term-sources.json](../tools/term-sources.json)。运行时只请求本服／既有 DATA_CDN，不请求 GitHub。

```sh
node tools/build-terms.mjs
# 已缓存固定输入时可完全离线复现
node tools/build-terms.mjs --offline
```

生成器校验输入 SHA-256，输入不一致时拒绝覆盖。更新版本需显式修改来源元数据；不静默跟随 master。语言译文复用现有 `data/i18n` overlay 和逐字段过期校验，缺失外服新词回落到既有语言链／中文；不引入另一套译文格式。重建游戏译文后再运行本工具，补回术语 overlay。

当前包含 147 条中文术语，覆盖现有游戏文本使用的全部 54 个术语及说明中的关联引用。没有根据术语名称推测本模式额外规则；如以后发现模式差异，应在生成流程中明确记录依据及覆盖范围，不修改原始官方缓存。

验证：`test/ui/terms.test.js`、`test/ui/richText.test.js`；`SP_E2E=1 node --test test/ui/term-help.e2e.test.js test/ui/term-help-codex.e2e.test.js` 验证 Chrome／Firefox 交互与真实生产百科截图。
