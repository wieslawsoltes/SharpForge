# Measuring bound invocation retention

The SF-A20-T14 parameter-info correction retains an analysis-owned record per
bound invocation and adds a source-model invocation index. This is a binder
allocation change, so CONTRIBUTING requires measured before/after evidence.
This document and the three scripts prepare that measurement. **They have not
been executed for qualification at this source checkpoint. No timing, memory
improvement, regression percentage or noise claim is recorded here.**

## Revisions and small source exports

The exact pre-change baseline is
`3f7e51a69cff658e55103626fd3ba1a2128692e3`. It has the public `Compilation` and
`SourceSemanticModel` APIs used by the harness, but predates invocation
retention introduced by `ee1874b3`. The original completed provider candidate is
`02c8bd1745a14f0d0546e3555b2115f48d3cf872`. For final qualification, capture the
current committed integration head after all corrections have landed and use
that full SHA as the candidate. The report embeds the exact commit identity.

`scripts/benchmarks/a20-provider-binding-export.mjs` reads a commit's compiler
package manifest and follows its declared SharpForge package dependencies. It
exports only each package's `src` directory and package manifest, then creates
local package links inside that new export. It copies the **same current
benchmark file** into both exports and records its SHA-256. It runs no package
manager, build, compiler or benchmark and creates no Git worktree. Existing
destination directories are refused; it never resets, edits or deletes a
working checkout. Failed exports are left available for inspection.

Static Git inspection of the baseline identified ten packages: `compiler`,
`syntax`, `text`, `bytecode`, `cil`, `symbols`, `framework`, `archive`,
`bcl-core`, and `bcl-collections`. Their 723 source files contain 4,302,985 bytes
(about 4.1 MiB), plus ten small package manifests. The export helper reports
its actual inventory at execution. This avoids another complete repository
checkout while retaining each revision's independent dependency graph. Git,
Node and the system `tar` program are required; no new dependency is added.

## What is measured

The deterministic corpus contains repeated source calls with a fixed numeric
sequence. Default size is 96 calls per family; generic cases contain both a
constructed-receiver call and a generic-method call for each repetition.

| Family | Bound behavior exercised |
| --- | --- |
| Instance overloads | A local receiver with two available instance overloads and repeated selected integer calls. |
| Constructed generic receiver | `Receiver<int>.Echo` and `Identity<int>` parameter substitutions and invocation metadata. |
| Local functions | Repeated calls to a lexically declared local function. |
| Incomplete instance call | Complete preceding calls followed by an unfinished invocation and missing closing syntax. |

Each family has two independently warmed phases:

- **`compile`:** public `compile(input, {outputKind: 'library', pipeline: 'bound'})`,
  including parsing, execution-profile binding/emission and any semantic
  fallback the real compiler performs. No PE emission is requested.
- **`source-model-bind`:** construct fresh syntax and a fresh public
  `Compilation` before timing, then measure `Compilation.getSourceModel()`.
  This includes full lossless-source binding and public query-index creation.
  Parsing and `Compilation` construction are excluded from this phase. It
  measures the combined invocation-retention/index cost, not an isolated
  private binder micro-operation.

Both phases use public compiler entry points. Syntax and text preparation use
their public package entry points too. The harness neither imports compiler
internals nor monkey-patches the binder. It creates a new compilation per
sample, so it does not accidentally time a cached source model.

Defaults are **five warmups followed by fifteen measured samples** per family
and phase. The command accepts 9–101 samples and 3–50 warmups. It records raw
samples, median, nearest-rank p95, minimum and maximum. With fifteen samples
the nearest-rank p95 is the maximum; this is a coarse descriptive tail measure,
not an estimate with a claimed confidence interval.

Imports, explicit GC, result observations and report writing occur outside the
timer. The baseline and candidate run in separate processes, so neither can
reuse the other's modules or compilation objects. Machine, CPU, Node/V8,
effective heap limit, Node flags and load-average snapshots accompany results.
Load averages do not prove a quiet machine. Run in the reserved serial slot
without overlapping other agents' heavy work and report whether the host was
shared.

## Heap and allocation interpretation

`--expose-gc` is mandatory. After input preparation the harness requests GC and
records heap usage; after the operation it records uncollected usage, requests
GC again, then records retained usage while the returned result is still
strongly reachable. Public result observation follows the second measurement.

- `retainedHeapDeltaBytes` measures live JavaScript heap growth for that result.
  It is especially useful for the source model, which retains invocation records
  and indexes. Fresh parsed input was already retained at the bind baseline.
- `uncollectedHeapDeltaBytes` is an allocation-pressure proxy. Automatic GC can
  run during the timed operation, so it is **not total allocated bytes or an
  allocation rate**. The harness makes no per-object allocation-count claim.
- Retained external/ArrayBuffer deltas and process RSS are also recorded, so
  typed bytecode storage is not implicitly described as JavaScript heap.

Deltas may be negative due to collection or runtime caching. They must be
reported as observed rather than clipped to zero or labelled noise-free.
Before/after retained-heap medians are compared as an absolute byte difference;
the comparator avoids meaningless percentages against a zero/negative heap
baseline.

## Exact commands for the reserved qualification slot

Run these from the final committed integration checkout, after these scripts
are merged. The candidate is a captured commit, so subsequent working-tree
edits cannot enter either export. Choose a writable scratch parent with enough
space; the example uses this session's existing scratch directory.

```sh
provider_bench_root=$(mktemp -d /workspace/scratch/6b99131ca908/p16-provider-bench.XXXXXX)
provider_candidate=$(git rev-parse HEAD)
node scripts/benchmarks/a20-provider-binding-export.mjs 3f7e51a69cff658e55103626fd3ba1a2128692e3 "$provider_bench_root/baseline"
node scripts/benchmarks/a20-provider-binding-export.mjs "$provider_candidate" "$provider_bench_root/candidate"
node scripts/limited.js node --expose-gc "$provider_bench_root/baseline/a20-provider-binding.mjs" --calls 96 --samples 15 --warmups 5 --output "$provider_bench_root/baseline.json"
node scripts/limited.js node --expose-gc "$provider_bench_root/candidate/a20-provider-binding.mjs" --calls 96 --samples 15 --warmups 5 --output "$provider_bench_root/candidate.json"
node scripts/benchmarks/a20-provider-binding-compare.mjs "$provider_bench_root/baseline.json" "$provider_bench_root/candidate.json" > "$provider_bench_root/comparison.json"
```

For the isolated original provider candidate, replace the captured candidate
variable with `02c8bd1745a14f0d0546e3555b2115f48d3cf872`; keep the harness and
all settings identical. Do not run both candidate definitions unless resolving
a specific attribution question from the final comparison.

The comparator refuses mismatched harness hashes, source corpus, settings,
Node/V8/heap configuration, machine identity fields or observed compiler/query
results. It emits signed median/p95 changes, absolute retained-heap differences
and a descriptive flag for median slowdown above 5%. A flag is evidence for
review under CONTRIBUTING's regression budget; it is not automatic proof of a
statistically significant regression. If a meaningful slowdown remains, record
the concrete correctness tradeoff and obtain the required sign-off instead of
silently declaring the budget met. Preserve both raw JSON files and the
comparison in the final qualification evidence.

No browser, native CLR, Visual Studio or performance qualification success is
implied by the presence of this harness.
