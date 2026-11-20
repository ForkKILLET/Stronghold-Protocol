# 选中干员范围斜纹

主线基线：bb1172306227e5d2511db85df2cc5cf664ace0a3。修复提交：c827b7b0f21bde85dec345ca520f91f3b75e4974。

Chrome 真实 GameScreen／Pixi／Three 渲染器，编队和 Boss 预览为受控夹具；MAP09 使用主线 pieces 场景。before.png 仅将三个改动模块恢复为基线源码，其余环境与修复截图相同。

Chrome 四组左右／攻击／治疗、短屏、2D／3D、关闭／重选／拖动和 Esc 均通过。浏览器收据见 chrome.json。

Firefox 本机在详情打开后发生原生 signal 11；未修改基线保留详情 5 秒同样复现，未计通过。基线既有 data-URL CSP 诊断保留。
