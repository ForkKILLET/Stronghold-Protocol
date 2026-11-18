# Settings categories and search — 2026-11-19

Baseline: upstream dev c2b4ca01089dd753d3caeca5b6693ba8074e2505. Candidate: b93a7cd3237f26f74a7bba94aa0b3e0d86c5a591.

The screenshots use the real SettingsModal from the title screen, local fonts/assets and isolated Chrome/Firefox profiles. Google Fonts CSS is replaced with an empty response for repeatable offline rendering. The before/after desktop pair is 1440×900; short audio is 844×390; portrait is 390×844 with extra-large English text. All six categories were captured locally in both browsers. Four viewport sizes were checked for layout overflow.

The browser regression edits the real cross-category result control, checks persistence after reload, exercises tabs/shortcut capture, retains a diagnostic report, and imports a generated color-only theme ZIP. File.arrayBuffer for that fixture is held until the page has navigated to another category, then released; the real import and live search index complete afterwards. Reopening settings starts at Interface with an empty query. Both final browser runs have no page/console errors or HTTP failures.

The targeted CPU/documentation run passed 101 checks and skipped one optional installed-theme fixture. Types, modified-file lint and all four translation packs passed. Import checking reports three existing nodeData Node imports. Additional completed entry/storage/modal checks and legacy run limits are recorded in receipt.json. In the legacy game-mock environment, both baseline and candidate request the same missing bond_level_3.png; the theme suite separately timed out during initial navigation. The broader 3D screen-fit run was interrupted at its canvas prerequisite. Original logs are retained under .state/settings-pr-20261119. Full local simulation/golden remain paused.
