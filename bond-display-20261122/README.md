# Bond activation plates and briefing badge alignment

Source: `fix/bond-activation-and-badge` at `3f5a458059e92b7f832dfd45ace38cd8287668ac`, based on dev `d4531f0a1c943e910b00f32bed770826e47a1cbc`.

The before images use the base revision’s original BondDisc component and CSS; the after images use the fix. Other page code, local art and input data are the same. The real briefing and bond components run with controlled mock inputs, rather than a full WebSocket match.

- The strip fixture passes two 精准 and three 维多利亚 members, both at tier I. Activated discs at all tiers use the same lit centre; rings still show tiers. Inactive progress and disabled states stay grey.
- The briefing contains 23 bonds. The base shows up to 7.80 CSS pixels of vertical centre displacement; both browsers show zero displacement after the fix.
- Chrome and Firefox checked desktop 1440×900, short landscape 844×390, tier changes, opening details and closing with Escape. Final receipts contain no page, console or HTTP errors.
- The source branch’s opt-in Chrome browser regression was executed successfully. Full local simulation and golden validation remain paused; upstream Actions runs the complete checks after publication.

Official reference: [the screenshot supplied in #923](https://github.com/sganggs/Stronghold-Protocol/pull/923#issuecomment-6950747103), showing the first activated tier with the same centre brightness as the higher tiers.
