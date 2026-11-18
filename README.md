# Map follow-up review evidence (2026-11-19)

Code baseline: upstream dev c2b4ca01089dd753d3caeca5b6693ba8074e2505, including #977.

- Boss preview before/after: real GameScreen and its preview/return controls, with the original game-mock fixtures. These are controlled display states, not a live WS match.
- Transport: the existing extracted MAP05/10/12 mesh binaries were passed through the new production split writer. All joined SHA-256 values equal the original bytes. Nine Firefox render-demo captures cover prep/unite/Boss. The selected MAP10 Boss image is attached here. The reporting fork's resource-pack builder produced nine ZIPs (largest 15,010,851 bytes); every one of fourteen payloads was read back and size/SHA-1 checked. This is compatibility with that fork's 16 MB pack cap, not evidence that upstream's 256 MiB entry cap is exceeded.
- Snow: the production opaque-albedo helper was applied to the already encoded native atlas and the original scene material records. MAP09/11 have identical decoded RGB in the companion and native atlas. Six Firefox render-demo captures cover all three views. This is not a new affected-Edge-device test or proof of the original device failure's root cause.
- Terrain: original Tile._effect sources and MapSettings.highlandHeight were read from the installed PC bundles. Metadata production was exercised against nine prefabs (MAP04/06/09, all three pieces), with unchanged existing mesh bytes. Nine Firefox render-demo captures cover the three views. The selected images show native Originium, mire and concealment; the lowest MAP09 red edge is hidden by the front bench. No sand/light fitting is included in these candidate images.
- Sand comparison and grass fork/PR977 images are earlier comparison references, not the candidate's new validation.

These checks exercise the actual renderers in Firefox with local assets. They do not rerun full Unity mesh extraction, full WS matches, local full simulation/golden, or the affected player's hardware. GameScreen fixtures retain the known data-URL CSP diagnostic and missing bond_level_3.png HTTP 404; render-demo captures had no HTTP failures. Intermediate failed checks are retained locally, including a terrain startup access before meshes were built, corrected before submission and covered by a regression test.

Only screenshots and receipts are published here; no game models or textures.

Final terrain GameScreen recheck: native-height MAP04 retains two map effects after 60 seconds, survives battle FX clear, clears on off/2D and restarts on lite/3D. No frame-failed diagnostic remains; only the listed baseline CSP/404 remain. See terrain-lifecycle.json and terrain-m04-60s.png. The startup regression test is included in the 106 passing directed/documentation checks.
