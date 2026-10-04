# A05 eight-case browser qualification — 2026-10-04

All three jobs in [browser run 37229843622](https://github.com/wieslawsoltes/SharpForge/actions/runs/37229843622)
passed all eight cases on pushed commit `36a2af53287a563fd47d3a33b8e6e6382a726d35`,
tree `da3add4a11cce5ed887d2a093eac4b48a4c26754`.

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

This browser archive qualifies the exact `36a2af53…` push head. The concurrent PR
merge `edfa7cc8e11e05b9ceb0f6fdcb43fe071b24e11e` has the same product tree.
The subsequently completed [native matrix](native/README.md) and
[core failure record](ci-status/README.md) are separate evidence. The core job
failed three legacy-adapter assertions; its downstream platform jobs were skipped.
No result here qualifies later return-path or A01 repairs. Earlier `312cd924…`
and `ca97a540…` archives retain their own results.
