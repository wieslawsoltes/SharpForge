# Final repair validation checkpoint — 2026-10-04

The broad A05 selection passed **3320/3320 tests** on `02c941f53`. Subsequent
focused, constant, byref and static checks passed on their recorded revisions.
The build on `8f6eba479` **failed with a static module cycle through heap.js**;
this archive preserves that failure and does not claim a completed release gate.

The [manifest](manifest.json) records full revisions and trees, raw-byte hashes,
commands and resource settings. The [final gates journal](a05-native-final-gates-journal.json)
retains exact invocation and timing evidence for quarantine, byref and build.
The [generator journal](a05-native-final-generators-journal.json) records fresh
diagnostic-code and bound-node checks with exact command lines on `8f6eba479`.
Earlier failed attempts in the [parent archive](../README.md) remain unchanged.

| Revision | Output | Result |
| --- | --- | --- |
| `02c941f53` | [Broad A05/preemption/security selection](a05-native-repairs-full-02c941f53.log) | 3320/3320 tests passed; no skips; 369203.956585 ms |
| `02c941f53` | [Eight-file native repair selection](a05-native-final-focused-r1.log) | 63/63 tests passed; no skips; 6951.566972 ms |
| `02c941f53` | [Bound-node generator check](a05-bound-nodes-02c941f53.log) | Coordinator-reported exit 0; empty log; exact argv unavailable |
| `9f55b3391` | [Original license check](a05-oracle-license-9f55b3391.log) | Failed: sparse checkout omitted the tracked policy JSON |
| `9f55b3391` | [License check rerun](a05-oracle-license-9f55b3391-r2.log) | Passed after materializing unchanged tracked configuration |
| `9f55b3391` | [Advisory structure check](a05-structure-9f55b3391.log) | Exit 0 with structural warnings; this is not a zero-warning claim |
| `8f6eba479` | [npm check](a05-native-final-npm-check.log) | Passed manifests, syntax and static-import checks |
| `8f6eba479` | [Constant and literal regressions](a05-native-final-constants.log) | 16/16 tests passed; no skips; 3256.064069 ms |
| `8f6eba479` | [Diagnostic-code generator check](a05-native-final-diagnostic-codes.log) | Coordinator-reported exit 0; empty log; exact argv unavailable |
| `8f6eba479` | [Diagnostic-code check rerun](a05-native-final-diagnostic-codes-r2.log) | Passed; exact invocation and exit recorded in generator journal |
| `8f6eba479` | [Bound-node check rerun](a05-native-final-bound-nodes-r2.log) | Passed; exact invocation and exit recorded in generator journal |
| `8f6eba479` | [Original quarantine check](a05-native-final-quarantine.log) | Failed: sparse checkout omitted the tracked quarantine JSON |
| `8f6eba479` | [Quarantine rerun](a05-native-final-quarantine-r2.log) | Passed; zero active entries |
| `8f6eba479` | [Instruction-GC byref corpus](a05-native-final-byref.log) | 6/6 tests passed; no skips; 9229.394128 ms |
| `8f6eba479` | [Build](a05-native-final-build.log) | Failed: static module cycle through generated runtime heap.js |

The broad command selected `tests/a05-*.test.js`, `tests/preemption.test.js`, and
`tests/conformance/security/limits.test.js`. Its recorded wildcard is retained;
the shell's expanded per-file argv was not captured. This selection is not the
entire repository, the independent numeric differential corpus, or the byref
stress suite. The eight-file focused selection and later constant tests overlap
with broad coverage, so their counts must not be added.

The byref log independently records 1000 distinct seeded CIL programs, 131341
instructions and exactly 131341 actual collections, plus 96 source/reloaded/
compiler-CIL counterparts. It embeds the corpus hash, generator hashes, clean
tracked-tree claim, Node version and platform for `8f6eba479`. That passing Node
corpus does not establish fresh native, Rust or browser qualification.

The two initial configuration failures and the failed build are retained as
executed. Materializing omitted tracked JSON files corrected the sparse-checkout
failures without changing their contents. Later source style repairs do not
retroactively remove warnings from the earlier advisory structure output. The
coordinator supplied exit status for the empty generator logs; this archive does
not manufacture their exact command lines or additional output.
The later generator reruns have their own exact journal and passing exits;
their empty output is preserved too.

All recorded runs used the repository wrapper and resource controls of one
parallel run, one test worker and 512 MiB old space. Hashes prove byte identity
with supplied output files, not a complete independently captured runtime or
benchmark environment. Raw whitespace is preserved. Fresh external CI,
performance thresholds and a successful build after the cycle repair remain
separate evidence.
