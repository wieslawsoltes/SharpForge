# A05 optimization acceptance qualification

`bench/vm/qualification.js` measures the explicit Project 7 optimization requirements. It complements the T12 regression harness documented in [a05-vm.md](a05-vm.md). Its report format is `SharpForge.A05Qualification/1`; these reports cannot serve as T12 baseline files.

A requirement is complete only when its actual report meets the specified target on the recorded revision. Successful guest execution leaves a missed or uncertain performance target unresolved. All measurements retain exact revision/environment provenance and raw observations.

## Acceptance mapping

| Project item | Requirement and reference |
|---|---|
| [#1390: decode plans](https://github.com/wieslawsoltes/SharpForge/issues/1390) | Report CIL cold construction/preparation; warm calls must allocate zero new decode offset maps. |
| [#1391: virtual calls](https://github.com/wieslawsoltes/SharpForge/issues/1391) | Genuine derived `callvirt` loop versus `inlineCaches:false`, requiring at least 3× speedup. |
| [#1392: fields](https://github.com/wieslawsoltes/SharpForge/issues/1392) | Zero warm `AssemblyInspector.resolveToken` calls on the field loop. A subclass counts the actual public method; both timed modes retain the current cache. |
| [#1394: source fusion](https://github.com/wieslawsoltes/SharpForge/issues/1394) | Integer loop and Fibonacci versus `sourceFusion:false`, each requiring at least 1.5× speedup with identical guest instruction counts and expected output. |
| [#1396: Int32 specialization](https://github.com/wieslawsoltes/SharpForge/issues/1396) | At least 1,000,000 verified-CIL generic/specialized comparisons, plus at least 2× speedup on the Int32 loop. |
| [#1397: small Int64 values](https://github.com/wieslawsoltes/SharpForge/issues/1397) | At least 10,000,000 small-long/pure-BigInt comparisons, plus at least 3× speedup on the long counter loop. |
| [#1398: scalar slots](https://github.com/wieslawsoltes/SharpForge/issues/1398) | Repeated `ldloc`/`stloc` copies versus `scalarSlotLoads:false`; instruction-normalized time must fall by at least 30%. |
| [#1399: frame pool](https://github.com/wieslawsoltes/SharpForge/issues/1399) | Guest recursion to depth 128 on source/CIL. Every measured warm run must allocate zero new frame arrays/frames, and collection after unwind must restore baseline live objects. |
| [#1400: roots](https://github.com/wieslawsoltes/SharpForge/issues/1400) | Source/CIL scans of 500 actual VM frames with 32 canonical Int32 locals and one reference per frame. Visitor scanning requires at least 3× speedup versus `preciseRoots:false`. Both inventories and subsequent collections are checked. |
| [#1402: profiler](https://github.com/wieslawsoltes/SharpForge/issues/1402) | Profiling-off overhead must be strictly below 1% against the recorded hook-free reference on arithmetic, calls and allocation in source/CIL. Enabled overhead is reported separately, with equal output and exact instruction counts. |
| Managed-array fairness | Sort 1,000,000 descending elements on each source/CIL engine. Retain every actual sort-phase `runSlice` duration and its median/p95/p99/maximum. Verify every sorted element afterward. The observed maximum must be at most 16 ms with an 8 ms requested slice budget. |
| [#727: tiered fairness](https://github.com/wieslawsoltes/SharpForge/issues/727) | Separately run a 1,000,000-iteration CIL counter loop with actual Wasm OSR. Verify the return value and all 7,000,004 guest instructions against the interpreter, require a real OSR transition and selected Wasm instructions, and retain every candidate slice. The same 8 ms requested / 16 ms observed maximum applies. |

The root workload uses `vm.call` to create verified runtime frames outside the timer. Root liveness pruning is disabled so the managed-reference inventory stays identical; dedicated liveness tests cover dead-reference collection. Frame-pool qualification uses guest recursion and repeated entry invocation. Snapshot restore deliberately invalidates caches/pools, so this warm comparison performs no restore between observations.

Numeric differentials build arithmetic methods through public CIL APIs, construct both real VMs, prepare verified plans and require the expected selected handler identifier. Each comparison executes `vm.step` at the numeric instruction with identical operands, then checks results, fault type/message and consumed stack depth. Comparison counts remain separate from the VM instruction counter, which manual `step` does not increment.

Every operation begins with boundary pairs. Seeded cases then cover full signed Int32 inputs or mixed full-width, safe, narrow and near-safe-boundary Int64 inputs. Input-category counts describe operands, rather than fast-path execution counts. Reduced counts remain `partial`. The reference is the generic CLI handler or pure-BigInt handler; native CLR qualification remains separate.

## Protocol and decisions

Each ordinary target retains one VM per mode and re-enters main after termination. Initial construction and preparation are reported separately as single cold observations. First execution and configured warmup pairs remain in the JSON and are excluded from measured summaries. Execution order alternates on each pair.

Measured rows retain actual execution milliseconds, guest instruction counts, instructions/second, nanoseconds/instruction, managed allocations/bytes, frame allocation counters and decode-map counts. Host memory readings are process gauges. Exposed host GC occurs before a complete observation, outside its timer. Every guest result and corresponding instruction count is checked.

The target decision uses a deterministic paired percentile bootstrap of the ratio of medians, preserving entire before/after pairs. Reports retain the point estimate, 95% interval, seed and resample count. Minimum benefits require the entire interval to meet the target; profiler overhead requires its entire interval to remain strictly below 1%. An interval crossing the target remains `inconclusive`. Zero-counter requirements check every measured observation. Per-target intervals do not provide a family-wide confidence guarantee.

Array fairness records all continuation slices within one real sort. Initialization and complete result verification occur outside the sort timer. Its percentiles describe those slices, rather than independent complete-sort repetitions. Reduced arrays remain partial. Browser responsiveness requires separate browser evidence.

The fairness suite also records a separate `tiered-loop-fairness-cil` row. This is
the direct-CIL engine with Wasm tiering enabled, not a third source engine or a
claim that array sorting executes in Wasm. The counter loop first executes two
backedges (16 instructions) and waits for asynchronous compilation without
executing guest instructions. It then enters the actual Wasm tier at the next hot
backedge. Every candidate `runSlice`, including the initial 16-instruction slice,
OSR entry and final return, retains duration, guest count, selected-Wasm count,
OSR-transition count and host-memory gauges. Timed instruction totals must equal
the complete interpreter reference; compilation readiness alone cannot qualify
the row. The interpreter reference, VM construction, compilation wait, memory
probes and between-slice host yields are outside the individual slice timers.
Compilation wait duration is retained separately. Failed or unavailable Wasm is
a failed observation, and cancellation disposes the VM and tier selections.

The tiered loop has a fixed full size independent of `--array-elements`; reduced
unit-test loops are explicitly partial. It bounds evidence at 10,000 candidate
slices and retains the observed maximum without trimming outliers. This Node
workload does not qualify browser responsiveness, native CLR throughput or all
Wasm methods. Canonical source-image reload is not a distinct tier and is not
claimed by this row.

## Serial commands

Use the repository's single validation slot, a clean committed integrated tree and the same otherwise idle runner. Replace `dedicated-node24-01` with the actual stable runner identifier. Run commands sequentially. The driver enforces its total configured deadline and stops VMs on interruption. The focused tests use reduced workloads and do not satisfy full numeric/performance requirements.

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test --test-concurrency=1 tests/a05-qualification-numeric.test.js tests/a05-qualification-targets.test.js tests/a05-profiler-reference.test.js tests/a05-qualification-options.test.js tests/a05-qualification-fairness.test.js
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test --test-concurrency=1 tests/preemption.test.js tests/a05-11-wasm-osr.test.js
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite differential --width 32 --out artifacts/a05-int32-million.json
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite differential --width 64 --out artifacts/a05-int64-ten-million.json
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite targets --out artifacts/a05-targets.json
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite roots --out artifacts/a05-roots.json
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite fairness --out artifacts/a05-array-fairness.json
node bench/vm/profiler-reference.js --dir ../a05-profiler-reference --out artifacts/a05-profiler-reference.json
node --max-old-space-size=512 --expose-gc bench/vm/qualification.js --runner dedicated-node24-01 --suite profiler --profiler-reference artifacts/a05-profiler-reference.json --out artifacts/a05-profiler.json
```

Defaults are 20 measured pairs, three warmup pairs, seed 12012, 10,000 bootstrap resamples, ABI32 and a 900-second total command deadline. Bounds are 20–1000 samples, 1–100 warmups, at most 10,000,000 differential cases per width, 1–1000 root scans per observation, 1,000,000 array elements and 3600 seconds. ABI64 uses `--native-bits 64` and separate result files. Increase sample counts when intervals cannot resolve a target.

Exit 0 means every required target in the selected suite met its requirement. Exit 1 indicates an execution/provenance failure or missed target. Exit 2 indicates incomplete or inconclusive requirements, including a missing profiler reference. `--suite all` without that reference cannot claim profiler completion. Selected suites/widths remain explicit in the protocol; one suite does not claim full Project 7 completion.

After optimization qualification, run the T12 first/repeat protocol from [a05-vm.md](a05-vm.md). Two complete same-revision runs must satisfy its 5% median repeatability rule before publishing a baseline. Keep provisional reports under `artifacts/` and commit the reviewed baseline afterward to preserve clean measurement provenance.

## Profiler reference provenance

The generator creates a detached Git worktree at exactly the product revision,
removes only enumerated profiling consumers/initializers, and commits those
removals locally. Dispatch, cleanup, events, pools, and public exports remain.
Both VM classes are byte-identical, including their private profiler slot and
constructor callback; initializers supply `null` through that same callback.
The allocation-notification module also remains byte-identical because its
callbacks serve arbitrary host observers, including synchronous GC and throwing
callbacks. Removing profiler initialization prevents attachment to that shared
hook. The profiler module remains loadable. This reference isolates execution
hook overhead and supports profiling off only.

The manifest retains the complete patch, patch SHA-256, transformation SHA-256, source/reference revisions, each changed file's before/after hash, command and creation time. It copies and records the product's sparse-checkout patterns before populating the reference, preserving source while avoiding excluded evidence directories. The loader recomputes the transformation and verifies clean worktrees, exact parent, complete changed-path set, transformed files, sparse patterns and patch. Unknown or moved hooks require review and cause failure. The reference never merges into the product.

Dependencies use a real reference `node_modules` directory containing links to
the immutable product's top-level dependency directories and copies of metadata
files. A whole-directory symlink would be untracked under the repository's
directory-only ignore rule. The manifest records and verifies this layout; clean
checks are unchanged. The runtime itself always loads from the explicit reference
`packages/runtime/src/index.js`, with an isolation regression exercising actual
source/CIL execution through that distinct API. Source-input proof records the
product parent, both runtime tree hashes and changed benchmark paths, identifying
whether a harness-only revision preserved all runtime/workload/threshold files.

The integrated-path audit is `tests/a05-profiler-reference-integration.test.js`. It
checks that prepared calls, pool capabilities and scrubbing, logical source type
identity/formatting, bounded source batches and callback storage remain
byte-identical, that batching loses only profiler eligibility guards, and that
transformed instruction/continuation modules still parse. New option-only
profiling gates or direct profiler calls fail closed until explicitly reviewed.
This static audit does not substitute for paired output/instruction equivalence
or the measured overhead interval.

Create a new reference after any product/harness commit; stale references are rejected. After retaining evidence, remove the disposable checkout with `git worktree remove ../a05-profiler-reference`. Its complete patch remains in the manifest for reconstruction.

## Separate evidence requirements

Typed-float tests inspect actual adapter materialization counters before return and compare exact numeric results. Managed allocation counts and RSS cannot establish zero JavaScript float-carrier creation; retain focused counter/differential assertions and applicable allocation/GC evidence for [#1395](https://github.com/wieslawsoltes/SharpForge/issues/1395).

Copy-on-write retention, 128-snapshot memory bounds and full-copy equivalence require the snapshot qualification workload. T12 separately measures capture/restore/export/import and validates replay. The fairness suite measures the one explicitly selected Node Wasm workload above; broader Wasm behavior, native CLR results, browser timing and architecture coverage retain their own qualification. Reports label the actual backend and leave unmeasured targets explicit.
