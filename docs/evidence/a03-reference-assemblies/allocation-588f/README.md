# Attribute allocation follow-up qualification

These observations qualify source `588f2b271521f170f278a0d0f183f069bd71f41d`, immediately after evidence commit
`4f80ef2a5bb952199b35cea7cf5ad83d1b87f6eb`. The product difference from qualified `51db` is limited to three compiler
metadata modules: canonical pseudo-attribute recognition before lazy writer construction, and allocation-free return
attribute presence scanning. All existing pseudo handlers, target rules, row writes and planning/token maps remain.
A new public-API regression checks interleaving and exact delegate return targets across three emission modes.

All six approved commands ran once, sequentially through `scripts/limited.js`, with clean tracked HEAD `588f`.
Every command exited zero. The exclusive heavy slot was released immediately after the last benchmark. No failure,
retry, historical-baseline rerun or broader product execution occurred. Subsequent archive work copied existing files.

| Check | Retained result |
| --- | --- |
| [Focused tests](execution/tests.tap) | 67 passed, zero failed, zero skipped; unchanged 66-test cohort plus the new three-mode dispatch/return regression. |
| [Full refout native capture](native/capture/reference.json) | Both public and friend cases passed complete metadata and consumer comparisons. SDK 10.0.201, Roslyn 5.3.0-2.26153.122, CoreCLR/reference pack 10.0.5, Linux x64. |
| [Attribute targets](execution/attribute-targets.log) | Newly emitted product assembly matched the existing pinned Roslyn output. |
| [Pseudo attributes](execution/pseudo-attributes.log) | Newly emitted product assembly matched the existing pinned Roslyn output, including interop. |
| [Metadata benchmark](benchmarks/metadata.json) | One run, all compile/mode/byte-determinism guards passed, all 120 chronological samples retained. |
| [Refout benchmark](benchmarks/refout.json) | One run, all compile/mode/byte-determinism guards passed, all 120 chronological samples retained. |

The two main fixture checks execute SharpForge images on CoreCLR using the installed reference pack. They do not
replace expected outputs, use `--update`, or freshly compile the pinned Roslyn executable fixtures. Full fixture source,
expected output and emitted images remain in `main-native/`. The full refout capture keeps all metadata observations,
both image pairs, positive consumer results and the exact negative fixed-buffer/friend-access diagnostic comparisons.

Every exact argv/environment/status record is in `execution/`, including UTC intervals, frozen revision and source/output
hashes. Correctness uses the pinned SDK environment; benchmarks omit unused SDK variables to match earlier runs.
The preparation file records the earlier pending boundary; completed execution records establish the actual outcome.
[manifest.json](manifest.json) inventories 77 raw files, 720,217 bytes, all copied and read back byte for byte. The three
changed production modules and new regression are also retained as frozen source snapshots.

The public/friend SharpForge DLLs, full SRM observations and metadata-control DLL are byte-identical to `51db`.
Both benchmark modes retain their own prior assembly hashes and 4,096-byte PE lengths. These correctness and size
observations do not establish a performance pass.

| Measurement | 51db metadata | 588f metadata | Change | 51db refout | 588f refout | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Median (ms) | 19.001903 | 16.218080 | -14.6502% | 13.762756 | 13.851561 | +0.6453% |
| p95 (ms) | 21.198717 | 23.102026 | **+8.9784%** | 18.920035 | 19.782001 | +4.5558% |
| p99 (ms) | 21.869242 | 27.814426 | **+27.1851%** | 20.102753 | 20.979140 | +4.3595% |
| First compilation (ms) | 133.244493 | 99.538362 | -25.2965% | 108.198931 | 145.724813 | **+34.6823%** |
| Compiler import (ms) | 404.946498 | 463.052459 | **+14.3490%** | 328.556521 | 553.077104 | **+68.3355%** |
| Median heap-used delta (bytes) | 4,014,220 | 4,003,668 | -0.2629% | 3,937,796 | 3,929,908 | -0.2003% |
| PE image bytes | 4,096 | 4,096 | 0% | 4,096 | 4,096 | 0% |

The metadata p95 and p99 increases exceed the 5% threshold and require coordinator review. The lower median does not
waive them. Refout first compilation and both compiler-import observations also exceed 5%; they are single observations,
with the unchanged driver preloading candidate CIL before the import timer. They do not estimate equivalent clean
process startup. No performance-budget pass or broad speedup is claimed, and no unfavorable observation was discarded.

Summaries exclude the first 20 of 120 samples. Median is the mean of the middle pair; p95/p99 use nearest rank.
All summaries were recalculated from the raw arrays. Heap-used deltas include temporaries and do not measure total
allocation or retained heap. PE lengths include alignment, not metadata payload or browser bundle size. Node 24.19.0,
Linux x64/kernel 6.18.44, AMD EPYC 9V74, nine visible CPUs, 10,451,464,192 bytes visible RAM, exposed GC and 2,048 MiB
V8 cap match prior runs. The team slot was exclusive on a shared hosted machine; external workloads were unmeasured.

[comparison.json](comparison.json) retains all exact immediate before/after, earlier 7c73/c169 and within-candidate mode
deltas. Earlier comparisons include other checkout/main changes; the two candidate modes emit different contracts.
For example, whole-checkout c169-to-588f metadata median is +4.3617% and p95 -2.4080%, while 7c73-to-588f metadata
p95 is +14.4165%. Neither replaces the immediate 51db-to-588f p95 regression. Prior evidence directories and their
original adverse results remain untouched. Source inspection motivates the allocation change but cannot establish how
much of any measured variation it caused.
