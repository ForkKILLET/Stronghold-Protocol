# PR review evidence, 2026-11-17

This branch contains review screenshots and an owner-provided original-game recording, not distributable game assets.

- MapEffect: dev 55f528e9 plus 3263a45f8, real fx-viewer, map_promote_01, full/lite, 0 and 60 simulated seconds.
- Summon placement: dev 55f528e9 plus 12d8dfcbd, real Match actions bridged to the game screen; roster initialization is a fixture. Actual pointer drags preserve a legal wolf and return it once out of range.
- Official recording: owner-provided 明日方舟 2026-11-12 01-00-52.mp4, entire 15-second sequence. Review copy only changes encoding to H.264, 1920x1080 / 30fps and removes the audio track. No frames cropped out of the sequence, no added overlays.
- Browser captures are bounded Firefox checks, not complete match simulation or golden validation. The game's existing data-URL CSP diagnostic reproduces on unchanged dev and is retained in local receipts.

- Temporary layers: dev plus PR #962 head 32782b85 and UI 065093d70. Real Match and explicitly loaded Regulation data feed the public browser runner/host; fixture seeds 100 permanent layers, then real Battle.addTempLayers adds 20. UI total is yellow 120, popup agrees. The fixture pauses its clock for screenshots and is not an end-to-end live-server/Worker match.
