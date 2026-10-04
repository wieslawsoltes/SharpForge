# A05 eight-case browser qualification — 2026-10-04

All three jobs in [browser run 37229435885](https://github.com/wieslawsoltes/SharpForge/actions/runs/37229435885)
passed all eight cases on pushed commit `ca97a540252605fec532768e68220495a858c02f`,
tree `08c3f8560c079bd5d370ef00dfa7529f3b936c10`.

| Engine | Actual version | Cases passed | Failed |
| --- | --- | ---: | ---: |
| Chromium | 153.0.8010.12 | 8 | 0 |
| Firefox | 155.0 | 8 | 0 |
| WebKit | 26.6 | 8 | 0 |

The additional `wasm-heap-bridge` case passed on every engine. Each report records
an actual 587-byte WebAssembly instantiation, all 19 selected method program counters,
and shared runtime imports including allocation, fields, arrays and managed calls.
Observed import counts include three allocations, three field operations, two array
operations and one managed call. The compiled and interpreted observations match:
22 instructions, 22 safepoint collections, five writes, three allocations totaling
116 bytes, exact profiler data, and the returned `rooted` string. The return-root
probe confirms survival while rooted and collection after removing that root.
The native module executes shared helpers; this is not a claim that every operation
runs without a host import.

The original seven cases also passed: Wasm execution, debugger deoptimization,
profile exports, CSP fallback, and source/reloaded/CIL profile imports in the
official Speedscope UI. Firefox ran headed under Xvfb; Chromium and WebKit ran
headless. WebKit's CSP proof retains its native compile rejection rather than
inventing an undelivered violation event.

The unmodified reports, runtime observations, session/console diagnostics, profile
exports, DOM/graphics observations and screenshots are retained. All three ZIP
digests matched GitHub's uploaded SHA-256 values. [manifest.json](manifest.json)
records exact artifact/job IDs, URLs, original entry paths and retained-file hashes.
Raw artifact/trace ZIPs and executable third-party UI assets remain external;
the official asset manifest is retained. GitHub artifact retention is 14 days.
No source, fixture, output or report was regenerated during archival.

This archive qualifies the exact `ca97a540…` push head. It does not qualify pending
native cells, a later reconciliation with main, or repository core/platform jobs.
The earlier `312cd924…` archive retains its original seven-case browser results.
