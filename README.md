# Variable scene transport and sequential writes — 2026-11-19

PR #979 candidate: 41403b29cf92d0b7bc980eb18e4ff2df07452bee, based on upstream dev c2b4ca01.
Reporting fork integration: 454de2ca9fba959380fdf45e0dd9110998a9e104.

The ordered manifest-key list has variable length. Loader/exporter policy retains a 60,000,000-byte total budget
and permits 256 parts of at most 15,000,000 bytes. A smaller `part_bytes` can produce more parts. The reader validates
the entire declaration, allocates one destination and writes each checked response before requesting the next.

Production writer calls repartitioned existing MAP05/10/12 binaries into seven pieces for both branches. All six
SHA-256 round trips match. The fork's production pack builder produced 7 PR / 4 main ZIPs, largest 15,401,177 /
15,772,524 bytes. All 27 / 33 files were read back and their size and SHA-1 verified.

Firefox's real render-demo loaded all seven pieces for three maps × prep/unite/Boss on each branch (18 captures).
The attached Boss images show the upstream candidate. Nine PR captures retain the baseline data-image connect-src
CSP diagnostic, without HTTP failures; the reporting fork's nine captures have no page/console/HTTP errors. The
render-demo is an empty-field display harness with actual renderer/assets, not a complete WS match. Each branch
keeps its original scene composition and materials; binary partitioning only changes transport bytes.

PR: 61 targeted + 32 documentation checks passed; main: 72 targeted + 32 documentation checks passed. Types and
modified-file lint passed for both, and the reporting fork's production build passed with its existing warnings.
Tests cover twelve JS parts and thirteen Python parts, numeric key order, complete declaration validation, limits,
single destination allocation, immediate writes, missing/truncated/oversized/rejected parts, allocation failure,
seven-part mesh parsing across attribute boundaries and fallback stopping later requests. The initial PR/Pillow
libz environment failure and earlier skipped checks remain in the local logs; the final runs have zero skips.

Allocation instrumentation proves constructor count and request/write order. Browser caches/network buffers and
GC timing can add memory beyond the loader's destination and current part. No browser peak-memory benchmark or
new full Unity mesh extraction was performed. Full local simulation/golden remain paused; upstream Actions run
on the new PR head. Original artifacts and logs remain under `.state/scene-transport-20261119`.
