# Reference assembly qualification evidence

This archive preserves the actual SF-A03-T22 observations, with their original paths, commands and output bytes.
Nothing was recaptured while archiving. [manifest.json](manifest.json) records SHA-256, original path and size for every
copied file; all copies were read back and compared byte for byte. Original absolute paths describe the capture
environment. Relative archive paths remain usable after checkout elsewhere.

| Directory | Source identity and result |
| --- | --- |
| [native-b40](native-b40/refout-qualified-b40-validation.json) | Product `b40e8f7b5b8f5d06ad992da4a0b7446d667a056e`: 45 tests passed, no failures or skips; full public and friend native comparisons passed. |
| [benchmarks](benchmarks/comparison.json) | Baseline `c1693a9e322295a43d90c3335885b5b5b3cf8daa` metadata and candidate `7c73c877c841fa5d4d124edfab980f5896a7e485` metadata/refout: three sequential once-only runs, all exited 0. |
| [failures/native-metadata-b939cb00](failures/native-metadata-b939cb00/native.log) | Historical failed SRM comparison before synthesized attribute and fixed-buffer reference-shape corrections. |
| [failures/native-consumer-1435807c](failures/native-consumer-1435807c/native.log) | Historical consumer failure after the older metadata projection matched; serialized `typeof` qualification was still missing. This is not final native qualification. |
| [failures/observer-enum-e14947ea](failures/observer-enum-e14947ea/native.log) | Original observer crash on an external enum-valued attribute. The log is retained; no completed native parity observation is claimed for this run. |
| [probes/both-image-fixed-buffer-consumer](probes/both-image-fixed-buffer-consumer/result.json) | Independent Roslyn/product probe that disproved the original blanket expectation that fixed buffers are consumable from Roslyn `/refonly` output. |

The successful [full native report](native-b40/capture/reference.json) is preserved alongside both Roslyn and SharpForge
DLLs, exact source inputs, independent enum-observer results, full public/friend SRM observations, raw compiler commands,
stdout and SARIF diagnostics. Its tool identity is SDK 10.0.201, Roslyn 5.3.0-2.26153.122 and reference pack/CoreCLR
10.0.5, Linux x64. The [validation record](native-b40/refout-qualified-b40-validation.json),
[native log](native-b40/refout-qualified-b40-native.log) and [test TAP](native-b40/refout-qualified-b40-tests.tap) retain
the actual commands and results. The compact fixture `qualification.json` is an index, not a replacement for this data.

Final public and friend comparisons include declarations, signatures, layout, custom attributes and their qualified
serialized type identities, MethodImpl rows and accessor associations. Positive consumers compile against both images.
The original consumer remains a negative fixture: both images produce the same three `CS0648` diagnostics and exact
spans for ordinary, generic and nested generic fixed-buffer access. Friend access compiles in the friend case and
matches `CS1061` in the public case. Both reference images have one standard marker and match CoreCLR's load rejection;
the marker-free metadata control loads. Earlier failures retain the observers used then, including their narrower
projections; they are not reclassified using the final observer.

The benchmark preparation, alias inventory, execution runner, three exact argv/environment/status records and raw
JSON/logs are in `benchmarks/`. All 120 chronological timing and heap samples per run remain intact. Summaries exclude
the first 20 samples and use a true median and nearest-rank p95/p99. Only the initial compile and sample compile calls
are timed; success, mode and deterministic-byte checks run outside the timed regions. The successful benchmark refout
image SHA-256 equals the qualified b40 public image's SHA-256.

The [comparison](benchmarks/comparison.json) and [feature documentation](../../reference-assembly-refout.md) distinguish
whole-checkout metadata changes from candidate output-mode differences. Median and p95 did not increase by over 5%;
single first-compilation observations increased by 11.4287% and 12.2639%, and candidate refout's single import observation
increased by 6.8201%. These need coordinator review; no performance-budget pass is claimed. Compiler import is not an
equivalent clean-startup comparison because the driver preloads candidate CIL for its inspector. All PE files are
4,096 bytes including alignment; metadata payload size and browser bundle size were not measured. Heap-used deltas
include temporaries and are neither total allocation nor retained-heap measurements. The team reserved one heavy slot
on a shared hosted machine, without measuring unrelated external workloads. No retry or favorable-result selection
was performed.

An independent read-only review recomputed every reported median and percentile, verified output/log hashes and
frozen source identities, and confirmed the runs' execution intervals do not overlap. It also noted that the calculated
candidate import-plus-first-compilation sum increased by 7.7825%; this sum omits other driver startup work and is not
a separate measurement. [comparison.json](benchmarks/comparison.json) retains that distinction and the review findings.
