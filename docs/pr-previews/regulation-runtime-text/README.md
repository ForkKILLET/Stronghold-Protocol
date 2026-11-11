# Regulation runtime description preview

Firefox, 1440 × 1000. Captured from `fix/regulation-runtime-showtags` (`fa2d8b3e`),
adapted to mainline dev `54d24b2b`.

The preview renders the actual GarrisonBlock and ItemDetail components with official regulation
records and the mainline styles. Before uses the unmodified mainline RichText module; after uses
the adapted renderer. The two round-count traits change from 3 to 9, next-payout examples stay at
2/1, and Passbook changes from 8 to 14 funds. These are explicit component-fixture values, not a
capture of a full match. Page errors were zero, and rich-text colouring was retained.

- [Before](before.png)
- [After, initial counts](after-initial.png)
- [After, updated counts](after.png)

Screenshots are review evidence only. No game assets or UI preview fixture are added to the source PR.
