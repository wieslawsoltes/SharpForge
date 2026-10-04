# SF-A13-T10.5 metadata inventory qualification

## Recorded first source and scope

The first focused gate passed **25/25 tests**, with no failures, cancellations,
skips or todos, at `55913c5129f2cfa684b6c647441ebdcf6b61d559` on 2026-10-04.
The Node-reported duration was **1,395.823535 ms**. This head contains product
source `7da8bdc75f834c1ebaa2c4b2585461fca80d7c97` plus the frozen benchmark tool.
The four-file gate covered the new inventory and retained-native comparisons,
plus the adjacent normal CFG and CFG-reference tests:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-10-metadata-inventory.test.js \
  tests/a13-10-metadata-inventory-native.test.js \
  tests/a13-07-cfg.test.js \
  tests/a13-07-cfg-reference.test.js
```

Coverage includes all 45 CLI and eight PDB table schemas, physical row identities,
wide row ranges, absent/empty tables, external PDB counts, minimal deltas,
method-output links, malformed names/rows, exact budgets, cancellation and owned
results. The native tests replay the unchanged table-view SRM observations for
the authored CLI PE, CLI metadata root and Portable PDB. They compare every
physical token, row extent and encoded scalar byte sequence, plus available typed
name columns. The four legacy processor/OS tables retain the actual SRM
`BadImageFormatException` rejection; physical enumeration does not assert that
SRM accepts those tables.

This was **retained native replay in Node**. No fresh native compilation or
execution, browser replay, other-OS run or build was performed for this inventory
gate. The authored browser entry remains `browser.mjs`. The reference toolchain
is SDK 10.0.201 / CoreCLR 10.0.5; its compiler/reference-pack hashes and exact
reference-image identities remain in the retained evidence.

## First controlled performance cohort

The sole first run compared actual merged main
`c1693a9e322295a43d90c3335885b5b5b3cf8daa` against measured head
`55913c5129f2cfa684b6c647441ebdcf6b61d559`. The original filename's `7da` denotes
the product revision, not a different executed head. Both package graphs used
their own checked and hashed public workspace aliases.

```sh
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-decompiler-inventory.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-inventory-baseline \
  --output /workspace/scratch/7e3d2a445c44/inventory-7da-vs-c169-benchmark.json
```

There are **200 warmup and 1,000 measured samples**, spanning ten
case/workload/variant groups. Each group has 20 warmups and 100 measurements;
each sample averages 20 API calls. The complete sequence, including warmups and
slow samples, is retained. Independent recomputation reproduced all **90**
reported timing/heap/ArrayBuffer median, p95 and p99 values exactly, and the
consumption checksum `483708000`. Each result was fully checked outside timing.

**All p95/p99 figures below are percentiles of 20-call batch means.** They are
not individual-call tail latencies. Median averages the two central measured
samples; p95 and p99 use nearest ranks 95 and 99 of 100. Values are rounded only
for the tables below; the report and independent recomputation retain full
numeric precision.

The ordinary fixture is the unchanged 1,536-byte `arithmeticLibrary()` with
three methods and 15 physical metadata rows. The native CFG fixture is the
unchanged 11,776-byte authored assembly with 38 methods and 341 rows. No input
was compiled or executed by this benchmark.

### Arithmetic assembly: existing whole-assembly API

Times and absolute changes are **microseconds per call**, summarized from batch means.

| Input/API | Statistic | Baseline | Candidate | Absolute change | Change |
| --- | --- | ---: | ---: | ---: | ---: |
| Bytes | Median | 72.283900 | 154.396500 | +82.112600 | +113.597357% |
| Bytes | p95 | 152.632500 | 379.386000 | +226.753500 | +148.561741% |
| Bytes | p99 | 303.862900 | 730.412650 | +426.549750 | +140.375725% |
| Cached inspector | Median | 21.719450 | 93.541950 | +71.822500 | +330.682867% |
| Cached inspector | p95 | 37.924800 | 207.597550 | +169.672750 | +447.392603% |
| Cached inspector | p99 | 77.101900 | 217.010450 | +139.908550 | +181.459277% |

### Native CFG assembly: existing whole-assembly API

Times and absolute changes are **milliseconds per call**, summarized from batch means.

| Input/API | Statistic | Baseline | Candidate | Absolute change | Change |
| --- | --- | ---: | ---: | ---: | ---: |
| Bytes | Median | 47.506043200 | 47.874247425 | +0.368204225 | +0.775068% |
| Bytes | p95 | 57.829114550 | 63.093715300 | +5.264600750 | +9.103720% |
| Bytes | p99 | 62.784909000 | 66.887640800 | +4.102731800 | +6.534583% |
| Cached inspector | Median | 44.725464250 | 46.256903925 | +1.531439675 | +3.424089% |
| Cached inspector | p95 | 57.957661150 | 57.384879900 | −0.572781250 | −0.988275% |
| Cached inspector | p99 | 64.637759450 | 64.418554000 | −0.219205450 | −0.339129% |

### New inventory stage

`inventoryOnly.cachedInspector` measures census, classification and option
validation using the current inspector and precomputed method results. It has
no baseline counterpart and is not a speedup measurement.

| Fixture | Unit | Median | p95 batch mean | p99 batch mean |
| --- | --- | ---: | ---: | ---: |
| Arithmetic | µs/call | 60.259450 | 108.693300 | 243.599250 |
| Native CFG | ms/call | 0.428098025 | 0.685741500 | 0.821404000 |

### Memory observations and host limits

The host was shared: Node v24.19.0, V8 13.6.233.17-node.51, Linux x64
6.18.44, AMD EPYC 9V74, nine visible logical CPUs and 10,451,464,192 bytes
reported memory. Initial load averages were 1.65/1.48/1.76. One exposed GC
call occurred before all warmups; there was no forced GC between samples.
Imports and complete correctness checks were outside timing. Both module
graphs lived in the same process, and each batch retained 20 return values
until its memory observation. No process-cold or isolated-host claim is made.

The following are **median observed byte deltas per 20-call batch**, not
per-call allocation counts, retained-output sizes or peak memory:

| Fixture/API | Variant | Heap delta, bytes | ArrayBuffer delta, bytes |
| --- | --- | ---: | ---: |
| Arithmetic / bytes | Baseline | 2,088,356 | 0 |
| Arithmetic / bytes | Candidate | 4,223,192 | 0 |
| Arithmetic / cached inspector | Baseline | 780,312 | 0 |
| Arithmetic / cached inspector | Candidate | 2,872,332 | 0 |
| Arithmetic / inventory only | Candidate | 2,190,400 | 0 |
| Native CFG / bytes | Baseline | 4,359,464 | 1,603 |
| Native CFG / bytes | Candidate | 16,103,716 | 1,032 |
| Native CFG / cached inspector | Baseline | 19,943,628 | −435 |
| Native CFG / cached inspector | Candidate | 32,715,748 | 300 |
| Native CFG / inventory only | Candidate | 11,919,052 | 0 |

Every memory sample and its p95/p99 remains in the unchanged report. Negative
samples are preserved, including a −214,730,592-byte heap delta during the
native inventory-only workload. Such values show intervening GC, not negative
allocation or demonstrated memory savings. GC, result retention, output guards
and shared scheduling can influence following samples.

## Independent source review and required follow-up

The review found no semantic defect in the inspected census, budget, ownership
or method-link flow. Owned table schemas, raw row arrays, summaries and method
links must be produced for each returned result. The input inspector is mutable,
and callers can mutate returned snapshots; reusing one previously returned
inventory would violate the documented contract and per-call budget behavior.
The 53-schema output imposes fixed work even on the 15-row arithmetic fixture.

That requirement does **not** justify every computation in the measured source.
Two concrete pieces of avoidable work were identified in `inventory.js`:

1. `census` allocates the column layout for each present table, then
   `createMetadataInventory` computes that same layout again for the returned
   table. A call-local layout can serve both purposes while remaining owned.
2. `rawRecord` reduces all column widths for every row even though width is
   constant within the table. The existing final column's `offset + width`
   provides the scalar once per table; the normal row bounds and per-column
   scalar checks can remain unchanged.

The separate product correction at
`20873aeb2df8f10604ce7bc4a28bc268a20ac73a` reuses each call's owned table layouts
and computes each row width from the existing final-column extent. It changes
only `inventory.js`; row/column checks, budgets, cancellation, output fields and
cross-call mutation visibility remain in place. The first cohort remains valid
evidence for its original source; it does not qualify the optimized source or
establish how much time these changes will save. Only the live benchmark product
pin and matching allowlist hash changed. The corrected source is **untested and
unmeasured** until the existing focused gate and unchanged predetermined cohort
run once in a later coordinated slot. Preserve a new report instead of replacing
the first cohort.

The arithmetic medians and the native byte-input p95/p99 exceed the repository's
5% comparison budget. The absolute costs above remain part of review. A passing
correctness gate or a completed benchmark is not performance acceptance.
Root will separately decide and explicitly justify any PR exception after the
correction is measured; no such exception or optimized result is recorded here.

## Retained artifacts

All five original root files were copied without changing their bytes:

- [Complete Node output](qualification/inventory-55913c51-tests.tap) and
  [test command/environment/status](qualification/inventory-55913c51-tests-execution.json).
  The original `.tap` filename contains Node's spec output.
- [Complete first benchmark report](qualification/inventory-7da-vs-c169-benchmark.json),
  [console log](qualification/inventory-7da-vs-c169-benchmark.log), and
  [benchmark command/environment/status](qualification/inventory-7da-vs-c169-benchmark-execution.json).
- [Exact measured benchmark source as text](qualification/benchmark-decompiler-inventory.mjs.txt).
- [Independent recomputation, review and complete hashes](qualification/summary.json).

The first report's SHA-256 is
`0aa9ba83ffbcf2ea105e2027ec8eb5ebaa418aa991f7a2d9038f6caa5c656c87`.
The measured driver SHA-256 is
`1784bac50545f62446dffdc372e43a6969fd0eab3d387f82e3f2b20248dfdef2`.
The table-view SRM reference SHA-256 is
`b9fe9c749515f4d14ab4da150b00a7f4bd33037d7bb903c40e03c67d865f05b7`.
Full command, product/tool/source and artifact identities are recorded with the
original execution head, independent of later documentation or optimization commits.
