# Byte-length scene part arrays — 2026-11-19

PR #979 candidate: 1a52e6a6dda6a2e9208961ca3e0f576cc0812e4b, based on upstream dev c2b4ca01.
Reporting fork integration: 3a3bc362c3b597ee6893d4c8178e6bcd9c4376ff.

`scene.json.binParts` is an ordered numeric array, such as `[15000000, 15000000, 2194384]`.
The loader derives manifest keys `bin`, `bin1`, ... from the indices. Explicit policy retains a
60,000,000-byte total budget, up to 256 parts of at most 15,000,000 bytes. The complete declaration
is checked first, then one destination receives each validated response before the next request.

Production writer calls repartitioned existing MAP05/10/12 binaries into seven pieces for each branch.
All six SHA-256 round trips match. Resource ZIP checks read back 27 PR / 33 main files; largest ZIPs
are 15,401,177 / 15,772,364 bytes, below the reporting deployment's unchanged 16,000,000-byte cap.

Final Firefox runs loaded the numeric arrays with the real render-demo: three maps × prep/unite/Boss
on each branch, 18 captures. Attached images show the PR candidate. HTTP failures are zero. PR captures
retain the exact previous data-image connect-src CSP diagnostic; main captures have no page/console
errors. These are empty-field display fixtures with actual renderer/assets, not complete WS matches.
The PR screenshots in `screens-pr-final` were captured after the final PR loader change; earlier
intermediate captures remain local for audit.

PR: 61 targeted + 32 documentation checks passed. Main: 73 targeted + 32 documentation checks passed.
Both typecheck and modified-file lint passed; main production build passed with existing warnings.
Tests verify numeric sizes, derived numeric key order beyond ten parts, complete validation before
allocation/reads, one destination, immediate writes, exception/truncation/oversize fallback and
seven-part real mesh parsing across attribute boundaries.

Allocation instrumentation checks constructor count and read/write order, not browser peak RSS or GC.
No full Unity mesh re-extraction was performed. Full local simulation/golden remain paused; new-head
upstream Actions are separate from these checks. Local evidence: `.state/scene-sizes-20261119`.
