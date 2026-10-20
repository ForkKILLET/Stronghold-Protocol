# Mobile management UI

This server branch keeps battlefield rendering, shop placement, HUD geometry, simulation, network protocol and chat
sizes separate from non-battle management UI. `public/css/utility-mobile.css` loads after `devices.css` in source
mode and in the Vite CSS bundle.

## Scope and density

Mobile rules apply below 1000 CSS pixels wide or below 600 CSS pixels tall. Normal desktop layout is unchanged.
The design's global `rem` remains unchanged. The local design unit `--ui-unit` comes from
`managementScale.js`, adopted from xinhai `506d297a` (reviewed through `e01036ae`). It fits the available
layout viewport to 1920×1080 below the global 40px rem floor. Only management roots opt in; shared
components fall back to `1rem`, and communication components explicitly retain their previous scale.
Shared typography uses
`var(--utility-text, var(--t))`; management containers alone define a readable floor derived from the saved text-size
setting. That variable must never be used for widths, heights or battlefield positioning.

| Surface | Mobile changes | Preserved behaviour |
| --- | --- | --- |
| Resource manager | Up to 17 design rem of available width; two columns on landscape phones; one below 560px; shorter category/voice rows | Required/optional and voice selection, counts, sizes, progress, active import category, pause, ZIP actions, warnings |
| Settings and shortcuts | Wider dialog, compact label/control rows, smaller gaps, wrapping footer | Browser preferences, four text sizes/FPS choices, diagnostics, bindings, language, sound, keyboard focus |
| Announcement/about/resume/import dialogs | Usable viewport height, wrapping text, fixed close/action areas | Links, disclaimer, notice scheduling, selected recovery identity, ZIP/data validation, drafts |
| Title/lobby/room | Compact cards/actions, fewer decorative gaps, no hidden difficulty explanations; actual-sized input text | Language/statistics/settings/preload entry points, matchmaking, all seats, mode rules, invitation controls |
| Operator loadout/ownership/DIY | Smaller aligned quick-choice buttons, compact filters, responsive grids | All skill/module/cultivation columns, bond labels, search, scrolling, the existing list/detail workflow |
| Local statistics/history | Compact header/cards/tables; full width; warnings remain visible | Local-only records, import/export, all columns, replay, damaged/newer-data warnings |
| Combat damage/healing panel | Pinned title/scope/close; ranking-first scrolling body; measured viewport fallback when the corner has too little room | Modeless display, normal corner-relative docking, own-player aggregation, battle default, all damage types, DPS/HPS and healing |
| Guide | Dynamic-height and safe-area budgets; scrollable chapter/dot controls and text fallback | All pages, 16:9 image rendering, close/navigation, keyboard shortcuts |
| Match information/console | Wider, bounded dialogs with compact controls | Server ownership/permissions, all data and actions, validation |
| Settlement / archived result | Local design units and responsive history layout | Result data, damage pages, return actions and combat HUD |

Settings and its separate shortcut editor use the game's `rem` geometry and saved `--t` typography, without the
generic utility text floor. Their controls have a `.6rem` minimum height; themed voice, language, FPS and shortcut
controls wrap or shrink within the row. Label/action SVGs use `em`, while the close glyph uses half its button.
Switch tracks/knobs, slider hit boxes/thumbs, spacing and diagnostic boxes use `rem` rather than fixed mobile
pixels. Text boxes retain the 16px iOS focus-zoom guard; selects use the shared themed popover. The existing global landscape gate,
safe areas, visible-viewport height, focus stack and scrollable body remain unchanged.

Utility dialogs explicitly opt into `Modal`'s `utility` prop. Their requested desktop width becomes
`--utility-width`, allowing the mobile stylesheet to resize them without an inline-width override. Other modals
retain their existing width behaviour. Utility headers gain a keyboard-accessible close button; the existing focus
trap, Escape handling, body scrolling and footer actions remain.

Management surfaces also use the existing `device.js` visual-viewport height (`--sp-vh`), capped by `100dvh`, so a
soft keyboard reduces their explicit size budget rather than leaving footer actions behind it. This is a static
budget contract; keyboard panning/focus behaviour still requires real-device verification.

Compact targets use their actual boxes, generally 24–36px high; they do not retain invisible 44px pseudo-elements
that overlap neighbouring controls. Text fields/native selects retain a 16px readable floor against iOS focus zoom.
Larger saved text sizes still enlarge content and may require scrolling; content is not truncated to meet a row budget.

The mobile damage panel has a definite measured height, not only `max-height`. Rank rows are non-shrinking and placed
before totals, legend and explanatory text in its single scrolling body; range switching and close stay in the head.
When fewer than 128px remain above the actual corner (or the corner is outside the visual viewport), it floats within
the visible safe-area bounds instead of rendering just a header. Window/visual-viewport resize and pan plus corner
ResizeObserver updates recalculate this placement. Desktop retains its independent rank-list scroll.

## Shared navigation and content budgets

All out-of-match and preparation pages use `PageHeader`; combat keeps its existing HUD. Short landscape
(orientation landscape, height ≤560px) merges return/status, centered title, tools and identity into one
44px row, approximately 53px including padding and border. The entry page also keeps its language control
in this row. Long titles use ellipsis with the full text retained; online count retains its icon and number
without the redundant label. Saved text size still affects typography within this compact row. The old 760/761px
transition no longer switches to a 169px three-row header. Navigation uses the same geometry on each page;
its local unit stays `1rem` so badges do not change width when entering a different management root.

The visible viewport is independent from layout scale: opening a keyboard changes `--sp-vh`,
`--sp-vtop` and `--sp-vleft`, without shrinking the design unit. Management screens, loadout, doctor archive
and guide own safe-area bounds once. Creation content and archive overlays must not override those bounds
with a second fullscreen `inset:0` or safe-area padding. Modal backdrops own their padding separately.

Short landscape content follows the remaining space below the header:

- Lobby decorative gaps shrink while the four entry actions remain together.
- Creation hides the decorative preview and shows difficulty, preparation and speed in three columns.
  Its one scrolling controls region contains all descriptions; creation/queue actions remain outside it.
- The room footer retains summary/status and tools/actions in two rows at both sides of 760px. Seats
  use the remaining height; only their region scrolls in very short viewports. Portrait fallback remains.
- Basic room options use three columns. Plugin content keeps its own existing layout, while save/return
  actions sit outside the scrolling body. Draft state and permissions are unchanged.
- Briefing columns, draft order, strategy grid and descriptions may scroll as content requires; the page
  itself does not. Strategy names wrap rather than producing horizontal grid overflow.

This is a selective UI integration, not a version-wide 0.3.1 merge. Existing fork equivalents of choice
visibility, chat, settlement and profile remain in place. Mainline `v0.3.1`'s screen-fit feature rewrites
`app-root` and gameplay `rem`; it is not copied into this management-only fix. Gameplay, plugin/protocol,
backend and asset-cache changes require their own integration. Do not restore the separate upstream
asset importer or local-only profile/statistics system as part of a UI stylesheet merge.

## Orientation

The existing global mandatory-landscape gate remains active on every mobile page, including management dialogs,
the guide and damage panel. No utility surface bypasses the rotate hint.

## Verification

- `test/ui/settings-mobile.test.js` checks settings/shortcut scaling, mobile/coarse-pointer cascade, SVG proportions,
  switch/slider geometry, native control wrapping and unchanged normal desktop dimensions.
- `test/ui/utility-mobile.test.js` checks the CSS contract, resource columns, retained content, real hit boxes, text
  scope, global orientation gate, and explicit width/height budgets at 320×568, 390×844, 640×360, 844×390, 915×412 and
  1000×600 with synthetic safe areas.
- `test/ui/combat-metrics-layout.test.js` covers 240–412px viewport heights, 34–148px wrapped corners, safe areas and
  visual-viewport shrink/pan; it explicitly reproduces the old header-only height budget.
- `test/ui/room-mobile.test.js` checks the actual room/shared/mobile CSS cascade,
  including both sides of 760/761px, portrait fallback, invitation glyphs and card framing.
- `test/ui/management-scale.test.js` covers local design units, safe areas, utility width conversion and keyboard pan.
- `SP_E2E=1 node test/ui/mobile-management.e2e.test.js` checks Chrome touch and Firefox across lobby, creation,
  room, options, doctor archive, full room, briefing and strategy selection. It asserts root overflow, safe-area
  ownership, header/control alignment, action reachability, unchanged global rem and actual server configuration.
  Set `SP_E2E_BUILD=1` after `npm run build` for the compiled client. Screenshots/measurements are written under
  `test/e2e/out/mobile-management/{source,build}/{chrome,firefox}` (ignored by Git).
- `test/ui/text-scale.test.js`, `test/ui/devices.test.js`, resource/voice tests, local statistics and combat metrics
  tests protect settings, data/aggregation behaviour and the unchanged battlefield geometry.
- `test/vite.test.js` verifies production CSS inclusion/order as well as existing simulation/CDN contracts.
- Opt-in device browser tests retain the landscape checks and now distinguish portrait utility/battle screens.

Static numeric budgets do not emulate intrinsic text widths, CSS layout, a virtual keyboard, real notches or touch
hit testing. A build/Node pass is not a browser or physical-device verification. When browser testing is requested,
check both source/production modes, Chinese/English, all text sizes, portrait/landscape, long lists/names/large
numbers, safe areas and nested dialogs; inspect screenshots and ensure every action can actually be tapped.

Deployment needs a new frontend build and updated hashed assets/HTML; restarting an old build will not apply this UI.

## 2026-10-20 review evidence

Local Chrome touch emulation and desktop Firefox: 640×360, 740×360, 760/761×360, 844×390
with synthetic 44px side / 21px bottom insets, 960×432, 740×360 extra-large text and 844×300.
Default 740×360 lobby/create/room/options have no outer scroll. Small screens or large text can
require intentional inner list/config scrolling, with actions remaining visible. Source and production
checks and representative screenshots are part of the opt-in test above.

Requested target: Huawei Mate 60, Firefox Nightly, fullscreen. These desktop automation results
do not verify that device's actual fullscreen viewport, keyboard or cutout reporting. A final
physical-device check should visit lobby → creation → room → configuration and open the doctor archive,
then rotate or open/close the keyboard and confirm the header does not jump or create page scrolling.
