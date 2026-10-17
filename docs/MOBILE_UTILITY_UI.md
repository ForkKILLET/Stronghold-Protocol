# Non-battle UI scaling

The title, lobby, protocol pages, room preparation, management dialogs, operator management, local history,
achievements, S.W.E.E.P., guide and plugin studio use the same design proportions across desktop and mobile.
The mandatory landscape gate remains global. Simulation, matchmaking, battle/HUD/shop/chat geometry and combat
statistics aggregation/positioning retain their existing behaviour.

## Local design units

- `public/js/ui/managementScale.js` computes a local unit from the layout viewport, safe-area insets and the
  existing root rem: `min(rem, availableWidth / 19.2, availableHeight / 10.8)`.
- `device.js` publishes `--sp-ui-unit` and `--sp-ui-scale` on resize/rotation. Only management roots opt into
  `--ui-unit`; shared components fall back to `1rem` elsewhere. Global rem and `--t` remain unchanged.
- Geometry uses `calc(designSize * var(--ui-unit, 1rem))`. Text uses `--utility-text`, derived from the saved
  `--t` times the local factor. Text preferences never change the unit or battlefield placement.
- Former pixel floors in management cards, text and spacing now scale as design lengths. Hairline borders stay
  in pixels. Native editable inputs/selects retain a 16px floor and enough line height to avoid iOS focus zoom.
- Modal's utility width is converted by `managementLength()`, including min()/calc() expressions. A requested
  7.4-unit settings dialog stays 7.4 units; crossing 1000px no longer replaces it with a 14-rem dialog.
- Settings action buttons override the generic utility minimum with a .36-unit height and .15 text coefficient.
  Its many-language dropdown uses a scaled button/listbox instead of a native select, retaining arrow/Home/End,
  Enter/Space, Escape, Tab, outside dismissal and focus return. Other editable native controls keep the 16px guard.

## Layout and ownership

The final layer `public/css/utility-mobile.css` loads after `devices.css` in source and production. It keeps
information visible instead of hiding explanations or changing the artwork at phone-width breakpoints. Truly
portrait windows may use an aspect-ratio fallback; rotatable phones still show the mandatory landscape hint.

Room tools keep equal icon squares with accessible names. Controls and invitation use intrinsic column widths;
the title stays in the same grid row and long translations can wrap within that column. Room art stays fully
visible at 1:2; automatic rows and scrolling handle content exceeding available height. Footer actions can wrap.
Operator lists, ownership/DIY grids, deck cards and details use the same units; portrait windows retain the
list/detail back flow. The achievement reference composition and full descriptions remain intact.

Protocol/report outer hosts own the viewport; their children apply safe-area padding once. Utility dialogs,
guide, operator pages and history bound their body/close/actions against `--sp-vh`. Visual-viewport pan publishes
`--sp-vtop` and `--sp-vleft`; visual-only keyboard shrink does not resize the underlying design canvas.
Native focus/keyboard behaviour on physical devices still needs verification.

Plugin management explicitly opts into utility Modal, sharing its focus stack, header close, scrolling body and
visible-viewport bounds. The independent studio loads device support, safe-area styles and local units too.
Game selection dialogs retain existing geometry and lifecycle. Actual touch boxes stay within their controls
rather than expanding over neighbours. Combat metrics/HUD overrides in the final layer are retained.

## Verification

- `test/ui/management-scale.test.js`: viewport/safe-area fit, continuous modal width across the old breakpoint,
  keyboard visual shrink/pan, outer-host ownership and unchanged battle roots.
- Settings/room/utility tests: CSS cascade, icon proportions, switch/slider units, native guards, retained content,
  intrinsic room columns, portrait row growth, focus and orientation.
- Existing skin, loadout, history, achievement, S.W.E.E.P., media, device and resource tests retain behaviour checks.
- Production build, Vite/static-client checks and typecheck verify source/bundle inclusion and compatibility.

These are static/component checks, not a font/layout engine, touch hit test, browser or real-device verification.
When requested, browser acceptance should cover source/production, Chinese/English, all text sizes, notches,
keyboard pan/shrink, long names/lists, nested dialogs and reachable close/actions. Deployment needs a fresh frontend
build; an old deployed bundle does not gain these changes merely by restarting its server.
