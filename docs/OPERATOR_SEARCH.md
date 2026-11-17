# 干员拼音搜索

各干员搜索入口共用 `public/js/ui/operatorSearch.js`，支持中文、原有英文代号、拼音全拼、首字母、
带空格／声调的拼音与中拼混输。例如 `miuersaisi`、`miu er sai si`、`mess`、`miu尔赛思` 均可查找缪尔赛思，
`chongyue`／`cy` 可查找重岳，`qiubai`／`qb` 可查找仇白。ü 可用 v 输入。

## 数据来源与核对

当前官方客户端干员表含中文名称、appellation 等字段，没有已确认的汉语拼音字段。
英文代号不能当汉语拼音使用，例如能天使的 Exusiai。

用户提示的输入法安装历史已核实：2026-10-11 从
[WantChane/fcitx5-pinyin-arknights](https://github.com/WantChane/fcitx5-pinyin-arknights)
的 [v26.10.09.a6df2b](https://github.com/WantChane/fcitx5-pinyin-arknights/releases/tag/v26.10.09.a6df2b)
安装 23 类、8,084 条 Rime 词条；安装提交 f4e3cbc 属于用户的个人配置仓库。
本机 `an_operator.dict.yaml` 确有词语与拼音两列，但它是 PRTS 词条衍生的社区生成词库，不能当作官服读音表。
实查「缪尔赛思」为 `mou er sai si`、「重岳」为 `zhong yue`、「仇白」为 `chou bai`，
不宜直接把这些编码当唯一读法。该社区数据不复制入本项目。

实际运行字表取自 **Unicode 官方 Unihan 17.0.0**：

- [固定下载](https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip)，归档及内部文本 SHA-256 见 `tools/search-pinyin-sources.json`。
- [kMandarin](https://www.unicode.org/reports/tr38/#kMandarin) 常用普通话读音。
- [kHanyuPinyin](https://www.unicode.org/reports/tr38/#kHanyuPinyin)《汉语大字典》读音。
- [kTGHZ2013](https://www.unicode.org/reports/tr38/#kTGHZ2013)《通用规范汉字字典》读音。
- [kXHC1983](https://www.unicode.org/reports/tr38/#kXHC1983)《现代汉语词典》读音。

合并上述字段的多音字读法作为**宽容搜索别名**，不是断言所有读法都是该干员的官方读音。
缪的 `miu` 来自字典字段，并非手工猜测；罕见读法可能使结果比单读音检索稍宽。
这是拼音匹配，不提供外号、模糊纠错、日语罗马字或任意动态名字的通用转写。
保留原有原文匹配，未收录的新字仍可按原名查找。

## 接入与边界

- 调配两视图和记牌器选人共用 `filterRoster`；职业、子职业及盟约文字也可用拼音检索。持有管理没有文本搜索入口，不额外添加。
- 自选编队候选保留原型／持有、职业、套件和已被其它槽占用等原规则。
- 房间名片干员、头像与立绘共用 `filterCardOperators`，保留稀有度过滤。
- 个人头像在原分类／顺序过滤后使用相同匹配；控制台仅扩展干员搜索，保留隐藏／自选／权限逻辑。
- 稳定 charId 映射至已有官方简体名字，因此切换界面语言后仍可拼音搜中文代号。
  不同语言原名与英文代号继续匹配，不删除日文假名的浊点。

只生成当前所有已发布赛季／本地化搜索字段所需的 827 字与 269 个 charId 名称映射，约 22 KB（未压缩）。
浏览器直接随 JS 加载，不查外部服务，不带完整词典或新增运行依赖。
候选字串索引最多缓存 1,024 条；匹配通过 KMP 状态集合处理多音字，不枚举所有读法组合。
共享搜索框上限由 24 放宽至 64 字符，容纳带空格的长拼音。

字表位于 `public/js/ui/searchReadings.js`，不修改 shared、玩法 JSON、库存、禁用规则、排序或版本内容身份。
账户、WS、检查点和回放格式保持不变；不会通过拼音额外公开未满足资格的干员。

## 更新

```sh
node tools/build-search-pinyin.mjs
node tools/build-search-pinyin.mjs --offline --check
```

首次命令下载固定 Unicode 归档；已有缓存离线可用。下载和解压后均核验摘要。
添加赛季、干员、职业／盟约或头像文字后重新生成；普通测试检查全部搜索字段覆盖，不联网。
不要手工修改生成的字表。Unicode 数据继续采用 Unicode-3.0 许可，全文见 [第三方声明](../THIRD-PARTY-NOTICES.md)。

定向验证：`test/ui/operator-search.test.js`、`test/ui/diy-ui.test.js` 及原调配／名片／头像测试。
`SP_E2E=1` 的 `test/ui/operator-search.e2e.test.js` 在独立 Chrome／Firefox 中操作真实管理页面与输入框；
房间选人与记牌器另挂载真实组件，记牌器明确断开数据连接，只检查搜索与禁用标记，不伪造库存或概率。
浏览器及构建沿用 [本机限额](LOCAL_TESTING.md)，完整模拟与 golden 仍暂停。
