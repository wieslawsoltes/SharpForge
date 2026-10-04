# Measuring bound invocation retention

The SF-A20-T14 parameter-info correction retains an analysis-owned record per
bound invocation and adds a source-model invocation index. This is a binder
allocation change, so CONTRIBUTING requires measured before/after evidence.
The first complete measurement found two binding medians above the 5% budget.
The source correction below removes avoidable retention and defers document
index construction. Completed follow-ups are recorded below, including the
final source-model median budget exceedance and deferred post-build query cost.
The revised harness exposes first and repeated signature-query costs separately; moving
work out of binding must not hide its cost when a user requests parameter info.

## Recorded first measurement and corrective decision

The coordinator ran the original harness on 2026-10-04 with the baseline below
and candidate `40bbdea7b45ab64b24c9741046b897a35118814e`. Harness SHA-256 was
`4e50768bee59ea2c779a871c5cca4ccf95daba121a4072558432fe528d451d49`.
Corpus, public observations, harness and environment matched. Each phase used
96 calls, five warmups and fifteen samples. The shared Linux x64 host reported
AMD EPYC 9V74, nine logical CPUs, Node v24.19.0 / V8 13.6.233.17-node.51,
`--expose-gc`, and `NODE_OPTIONS=--max-old-space-size=2048`.

| Binding family | Median before → initial candidate (ms) | p95 before → initial candidate (ms) | Median change | Retained heap median difference (bytes) |
| --- | --- | --- | --- | --- |
| Instance overloads | 14.368 → 15.181 | 16.506 → 19.198 | +5.66% | +74,176 |
| Constructed generic receiver | 24.888 → 22.802 | 29.091 → 26.199 | −8.38% | +133,352 |
| Local functions | 9.251 → 10.364 | 10.530 → 11.132 | +12.03% | +52,368 |
| Incomplete instance call | 13.691 → 12.805 | 17.382 → 17.322 | −6.47% | +71,296 |

All four compile medians were lower in this observation, while compile tails
were mixed. These are descriptive shared-host measurements, not a speedup,
noise or statistical-significance claim. Raw `baseline.json`, `candidate.json`,
`comparison.json` and `run.json` are retained in the session artifact directory
`p16-provider-bench-40bbdea7`.

The avoidable work was eager construction of every invocation's interval,
opening-offset Map and sorted document index, even for symbols/references
queries. The binder also retained raw argument arrays and duplicated URI and
syntax fields. The correction retains compact records in per-URI maps keyed
by syntax; selected results, bound method groups and invocation context remain
available. Unresolved calls remain present as nesting boundaries. The index
is created only on first signature help, and only the requested document is
indexed. Binary search replaces the duplicate opening-offset Map.

Capture remains amortized O(1) per invocation with O(N) retained records for N
invocations in the analysis. A document's first query constructs O(n) intervals
and sorts them in O(n log n). Later exact-opening queries use O(log n) lookup;
caret queries use O(log n + d), where d is containing-invocation depth. Indexes
belong to the captured source model and are never shared across revisions.
The focused `tests/a20-signature-query-index.test.js` covers document ownership,
exact lookup, nesting boundaries and revision replacement. The synchronized
provider/metadata cohort passed 50/50 at `1699e53a`; its matched benchmark and
subsequent capture-policy measurements are recorded below.

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

Each family has five independently warmed phases:

- **`compile`:** public `compile(input, {outputKind: 'library', pipeline: 'bound'})`,
  including parsing, execution-profile binding/emission and any semantic
  fallback the real compiler performs. No PE emission is requested.
- **`source-model-bind`:** construct fresh syntax and a fresh public
  `Compilation` before timing, then measure `Compilation.getSourceModel()`.
  This includes full lossless-source binding and eager public query indexes.
  Parsing and `Compilation` construction are excluded from this phase. It
  measures source-model construction, not an isolated private binder operation.
- **`signature-first-query`:** construct a fresh bound source model before
  timing, then make one public `SourceSemanticModel.signatureHelp` call at the
  selected invocation. This includes deferred index construction for that
  document and the returned signature information.
- **`signature-repeated-query`:** construct another fresh bound model and prime
  one signature query before timing, then measure a batch of 64 repeated
  queries. Both batch time and time divided by 64 are reported. The retained
  heap delta includes the last result and model changes; it does not claim
  that all 64 intermediate results remain live.
- **`compiled-model-first-query`:** build a fresh public `Compilation` and
  prepare its source model before timing, then measure its first signature
  query. If the model reused capture-free semantic fallback, this phase includes
  the private candidate analysis and its retained graph as well as the document
  index. This cost differs from a model whose original source bind captured
  invocation candidates. It must remain visible in the result table.

All phases use public compiler entry points. Syntax and text preparation use
their public package entry points too. The harness neither imports compiler
internals nor monkey-patches the binder. It creates a new compilation per
sample. All common compile/bind families finish before query measurements, so
candidate-only query work cannot prime a later common family. The old baseline
lacks the signature-help API: its query rows explicitly report unavailable.
The comparator labels the candidate's query rows **candidate-only** and emits
their actual timing/heap values without an invented baseline or percentage.

Defaults are **five warmups followed by fifteen measured samples** per family
and phase. The command accepts 9–101 samples and 3–50 warmups. It records raw
samples, median, nearest-rank p95, minimum and maximum. With fifteen samples
the nearest-rank p95 is the maximum; this is a coarse descriptive tail measure,
not an estimate with a claimed confidence interval.

An optional `--case` selects exactly one known family: `instance-overloads`,
`constructed-generic-receiver`, `local-functions`, or `incomplete-instance-call`.
Omitting it keeps all four families. Unknown names are rejected. The report
records the selected name, or `null` for all families, in `settings.case`; the
comparator requires identical settings and corpus on both sides.

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
  Query baselines already retain a bound model; the repeated-query baseline
  also retains its primed index. Both that model and the final signature result
  remain strongly reachable at the post-query GC measurement. First-query
  heap growth therefore exposes the deferred index and returned result.
  The compiled-model phase also exposes a separately retained candidate
  analysis when the original compilation did not request invocation capture.
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
results for shared phases. It emits signed median/p95 changes, absolute retained-heap differences
and a descriptive flag for median slowdown above 5%. A flag is evidence for
review under CONTRIBUTING's regression budget; it is not automatic proof of a
statistically significant regression. If a meaningful slowdown remains, record
the concrete correctness tradeoff and obtain the required sign-off instead of
silently declaring the budget met. Preserve both raw JSON files and the
comparison in the final qualification evidence.

The revised harness hash intentionally differs from the first measurement.
Re-export and rerun **both** revisions with this identical harness. Do not pair
an old report with a new one, or claim the revised binding phase alone meets
the cost of first signature help. Query rows use separate fresh models and
their medians must not be added to binding medians as if that were a measured
combined operation.

## Focused generic tail diagnostic

The synchronized provider/new-main metadata cohort passed 50/50 at
`1699e53a664bb54752a216a98f59a9f947da5eeb`. The matched-main comparison against
`ceced1c2ad0b7acead2333609d8568ab41f2f902` kept all eight timing medians at or
below +0.17%, but generic source-model-binding p95 was 27.546 → 36.100 ms
(+31.05%). With fifteen samples, that p95 is the maximum. Preserve this
observation and its raw samples; do not replace it with the diagnostic below.

The following single-family capture uses 101 samples and ten warmups on each
side. Its nearest-rank p95 is the 96th ordered sample, rather than the maximum.
It retains compile, bind, first-query and repeated-query phases, including
candidate-only query costs when the baseline API is absent. This is a focused
investigation of that concrete tail, not another four-family qualification.
The coordinator completed this diagnostic; its original result and concrete
compile-capture finding are retained below. The command describes that
historical source pair, not the later corrected candidate.

Run the current exporter so both captured source revisions receive the same
new harness; previously exported runners do not include the case filter.

```sh
provider_generic_root=$(mktemp -d /workspace/scratch/6b99131ca908/p16-provider-generic.XXXXXX)
node scripts/benchmarks/a20-provider-binding-export.mjs \
  ceced1c2ad0b7acead2333609d8568ab41f2f902 "$provider_generic_root/baseline"
node scripts/benchmarks/a20-provider-binding-export.mjs \
  1699e53a664bb54752a216a98f59a9f947da5eeb "$provider_generic_root/candidate"
node scripts/limited.js node --expose-gc "$provider_generic_root/baseline/a20-provider-binding.mjs" \
  --case constructed-generic-receiver --calls 96 --samples 101 --warmups 10 --output "$provider_generic_root/baseline.json"
node scripts/limited.js node --expose-gc "$provider_generic_root/candidate/a20-provider-binding.mjs" \
  --case constructed-generic-receiver --calls 96 --samples 101 --warmups 10 --output "$provider_generic_root/candidate.json"
node scripts/benchmarks/a20-provider-binding-compare.mjs \
  "$provider_generic_root/baseline.json" "$provider_generic_root/candidate.json" > "$provider_generic_root/comparison.json"
```

## Invocation capture ownership after the focused observation

The coordinator completed that 101-sample capture with matched source and
observations. Generic source-model binding measured median 22.9921 → 21.9837 ms
(−4.39%), p95 33.7089 → 27.1283 ms (−19.52%), and +109,104 bytes retained heap.
Generic compile measured median 38.7040 → 41.4977 ms (+7.22%) and p95
46.7355 → 59.5490 ms (+27.42%). Direct-model first-query p95 was 0.415637 ms;
repeated-query p95 was 0.00716692 ms per query. Preserve these alongside the
earlier fifteen-sample observations. The raw files are in session artifact
directory `p16-provider-tail-1699e53a`.

The compile entry, compilation driver, direct method pipeline and semantic
fallback modules are byte-identical between those matched revisions. The
**executed dependency graph is not identical**: the generic fixture reaches
`reconcileWithSemanticAnalysis`, which runs the lossless `SemanticAnalysis`
and its changed `BodyBinder.invocation`. The original capture hook therefore
allocated candidate records during compilation even though compilation only
consumes diagnostics and executable bound trees. No signature index was built
in that path. Its unchanged compile result is a profile rejection (four
`SF1012` diagnostics plus `SF2200`, no emitted image), so this measurement must
not be described as successful generic-code emission.

The source establishes added work in the timed path; it does not isolate how
much of the observed +2.7937 ms median difference is due to that work. No noise
claim or attribution of the entire difference to record allocation is made.
Compile retained-heap median fell by 4,688 bytes, which does not disprove
transient allocation while the temporary compilation was alive.

The subsequent ownership correction is implemented in `bee4b124` and
integrated at `48472269`:

- Ordinary semantic analysis and compilation fallback allocate no invocation
  map or candidate records. The binder still performs the same resolution and
  returns the same bound result; capture is an optional subsequent operation.
- A source model that performs a new analysis opts into capture in that bind.
- A source model reusing a complete compilation analysis keeps that exact
  analysis for symbols/references. Its first valid signature request creates
  one private capture-enabled analysis using the same parsed files and
  effective options. The signature index caches it for later requests. The
  original diagnostics, symbols and bound graph are not mutated.

This policy removes unused compile-only retention. It deliberately pays a
separate bind and retains its graph when a later signature request follows a
capture-free compilation. `compiled-model-first-query` now measures that
specific cost; it must not be inferred from the much smaller direct-model
first-query timing above. Both the ownership correction and this new phase
were subsequently exercised in the completed scope below.

`tests/a20-invocation-capture-ownership.test.js` supplies four focused cases for
compile-only retention, reused queries, private once-only capture, direct-model
capture and invalid requests. The complete ten-file affected cohort passed
65/65 with no skips in 7.027788 seconds at `48472269`; its exact command and
raw output are archived with the integration history. `1699e53a` above remains
the historical source before this ownership correction.

## Completed capture-policy measurement

Candidate `48472269ec106049debc0d448985882463365215` was compared against
matched-main baseline `ceced1c2ad0b7acead2333609d8568ab41f2f902`, both containing
captured main `9ac2d74d`. Both exports used harness SHA-256
`40b22884b7ddc8df546140890ad861b4692bea894dfe179596d0918a514ed90b`, 96 call
sites, 101 samples and ten warmups on the same shared Linux/x64 Node v24.19.0
host. Corpus and shared public observations matched.

| Phase | Median before → corrected candidate (ms) | p95 before → corrected candidate (ms) | Median change | Retained heap median difference (bytes) |
| --- | --- | --- | --- | --- |
| Compile, profile-rejection result | 43.719739 → 40.895091 | 67.302406 → 48.185120 | −6.46% | −1,712 |
| Source-model construction | 22.197639 → 24.410655 | 31.018274 → 32.235009 | **+9.97%** | **+117,112** |

The source-model median exceeds the 5% contribution budget. Lower compile
measurements do not offset it; this is not an overall performance-budget pass.
The intentional bound-candidate capture supports correct signature help and
its cost remains explicit. The root integration agent explicitly accepts this measured SF-A20-T14
correctness tradeoff, with the provider owner's recommendation: bound-candidate
retention supports correct signature information, unused compilation capture is
disabled, and direct/deferred query costs are measured. This is integration
review acceptance, not human approval or an overall 5% performance pass. No
statistical-significance or noise explanation is inferred.

| Candidate-only query | Median (ms) | p95 (ms) | Retained heap median (bytes) |
| --- | ---: | ---: | ---: |
| Direct-model first query | 0.344359 | 0.425181 | −16,056 |
| Primed repeated query, per query over 64 | 0.004783 | 0.007328 | −28,952 for the batch and retained final result |
| Compiled-model first query | **9.594653** | **14.425250** | **399,704** |

The last row includes the additional capture-enabled bind and retained analysis
when reusing a completed compilation. It is not interchangeable with the direct
model's smaller first-query cost. The baseline lacks the public signature API,
so no comparative query percentage is fabricated. Heap deltas remain observed
post-GC values and are not total allocation counts.

Exact raw reports, settings, environment, export manifests and invocation
metadata are retained in
[evidence/project16-integration/p16-provider-bench-48472269](evidence/project16-integration/p16-provider-bench-48472269/).
The [qualification history](project16-qualification-history.json) records all
four comparison captures, their exact source/tree identities and report
SHA-256 digests. Earlier compile and bind budget exceedances remain recorded;
no additional optional capture is planned.

No browser, native CLR, Visual Studio or performance qualification success is
implied by the presence of this harness.
