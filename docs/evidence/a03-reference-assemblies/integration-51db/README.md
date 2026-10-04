# Integrated reference and attribute emission

These observations qualify source `51db5c5ffbf870a3c2efd195477732d3e6861829`, the merge of frozen refout
`082eea2da4cc486fb3da40fa74b30cdb8b8e4e3e` with actual main `fbb0b086e05720eeacb954800a4a690a644313cd`.
The [merge-time record](../integration-fbb0.json) describes the two conflict resolutions and source hashes; its pending
validation status records that earlier preparation boundary. This directory contains the subsequent completed checks.

All six approved commands ran once, sequentially through `scripts/limited.js`, with frozen HEAD and a clean tracked
checkout. Every execution exited zero. The exclusive heavy slot was released immediately after the last benchmark.
No failure, retry, source fix, historical-baseline rerun, or wider qualification occurred in this replay.

| Check | Retained observation |
| --- | --- |
| [Focused tests](execution/tests.tap) | 66 passed, zero failed, zero skipped; refout, reference assembly, attribute emission/targets/pseudo attributes and executable generic fixed buffers. |
| [Complete native refout capture](native/capture/reference.json) | Both public and friend cases passed unchanged full metadata and consumer comparisons. SDK 10.0.201, Roslyn 5.3.0-2.26153.122, CoreCLR/reference pack 10.0.5, Linux x64. |
| [Attribute targets](execution/attribute-targets.log) | Product output matched the existing pinned Roslyn `.out`. |
| [Pseudo attributes](execution/pseudo-attributes.log) | Product output matched the existing pinned Roslyn `.out`, including the native interop fixture. |
| [Metadata benchmark](benchmarks/metadata.json) | One run, all guards passed, 120 chronological samples retained. |
| [Refout benchmark](benchmarks/refout.json) | One run, all guards passed, 120 chronological samples retained. |

The two main fixture checks used the installed reference pack and executed newly emitted SharpForge assemblies on
CoreCLR. They did not use `--update`, rewrite expected output, or freshly compile the pinned Roslyn executable fixtures.
Their source, expected output and emitted images are retained in `main-native/`.

Every exact argv/environment/status record is in `execution/`, with command start/end UTC, frozen revision, source
hashes and all produced artifact hashes. SDK variables were applied to correctness checks; the benchmark environment
matches the earlier runs without those unused variables. [manifest.json](manifest.json) inventories 73 original files,
688,183 bytes, copied and read back byte for byte. No recapture was performed while creating the archive.

Both public/friend emitted images and complete SRM JSON observations, plus the metadata-control image, are byte-identical
to their b40 counterparts. Both benchmark modes likewise preserve their respective 7c73 output hashes and 4,096-byte
PE lengths. The full native report and all consumer JSON/SARIF remain alongside the images; previous failures stay in
their original separately labelled directories.

[comparison.json](comparison.json) compares these runs to the saved 7c73 reports as whole-main-merge observations.
Ordinary metadata median increased **22.2381%**, p95 increased **4.9901%**, and its one-shot first compilation increased
**16.9232%**. Refout median changed **-9.2566%** and p95 **-2.2771%**. The metadata median crosses the 5% review threshold;
these recorded metadata regressions require coordinator review and no performance-budget pass is claimed. Native
byte equality does not waive performance review. All unfavorable results remain intact.

Import and first-compilation values are single observations; the driver preloads candidate CIL and does not measure
equivalent clean process startup. Heap-used deltas include temporaries, not total allocations or retained heap.
PE size includes padding and does not establish metadata payload or browser bundle size. The host was shared even
though the team reserved one heavy slot; unrelated external workloads were not measured. No causal attribution to
one merged feature or broad platform speedup is claimed.

An independent read-only review recomputed all 120-sample summaries and checked 64 execution/source/output hashes,
recorded byte counts and nonoverlapping execution intervals. [source-findings.json](source-findings.json) records the
subsequent source inspection requested by the coordinator. It found unchanged benchmark semantics and concrete added
work, without establishing a measured causal contribution or changing product source.
