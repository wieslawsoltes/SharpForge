# Object verifier performance evidence and disposition

The predefined cohort ran once and completed all 24 serial child processes.
Five existing-control medians exceeded the 5% policy threshold, and multiple
tails increased. The coordinating `/root` agent explicitly accepted these
measurements as a **specific automated-review performance exception**. This is
not a threshold pass or human approval; the 5% policy is unchanged.

The exception covers the complete retained control and tail results. Its stated
rationale is the correct six-operation support, the existing 52-case native
observations and scoped focused correction, modest absolute per-invocation
costs, and source review finding no concrete avoidable work on the regressing
paths. Causation remains unestablished. No observations are discarded or labeled
noise, and no profiling, rerun or product optimization accompanied this decision.
The authorization was supplied in the coordinating session and recorded in the
[evidence manifest](qualification/performance-manifest.json).

## Source, execution and retained bytes

- Baseline: `88c861e3a294a249e7a8cdd7319e032d7c29fb35`.
- Candidate and executable harness: `407ece8a532bdec026fca808097540eff10aefe3`.
- Outer execution: `2026-10-04T16:17:30.919735+00:00` through
  `2026-10-04T16:18:53.748539+00:00`, exit code 0.
- Children: `2026-10-04T16:17:31.400Z` through
  `2026-10-04T16:18:53.538Z`, all exit code 0, with no overlapping child intervals.
- Environment: Node `v24.19.0`, Linux x64, kernel `6.18.44`, AMD EPYC 9V74
  80-Core Processor, 9 reported logical CPUs, runner `4a20ccefcfde`.
  This was a shared local host; no isolated-host or pinned-image claim is made.
- Node executable SHA-256:
  `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`.

The retained [raw directory](qualification/performance-407ece8a/) contains all
**51 original files totaling 786,744 bytes**: 24 measurement reports, 24 child
process outputs, the cohort record, the zero-byte outer log and the execution
receipt. Original bytes and embedded absolute paths are preserved. The separately
retained [independent review](qualification/performance-independent-review.json)
is a byte-exact 29,890-byte copy. The manifest lists every retained file's byte
count and SHA-256, including all source/raw input/output identities from the run.

| Retained record | SHA-256 |
|---|---|
| [Cohort](qualification/performance-407ece8a/cohort/cohort.json) | `cfe4158b5ae9e5588d5fb09e670c9ea1fa60ca309249511fd3ecbeab3b4b689f` |
| [Execution receipt](qualification/performance-407ece8a/execution.json) | `ebeaa4a8c0abe173891d3571d9f0c0da9457f4822d1698786e59ec2189461b81` |
| [Empty outer log](qualification/performance-407ece8a/cohort.log) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| [Independent review](qualification/performance-independent-review.json) | `f44bfe729e8aff788a3dd70c983329afab758e3d18153d8d5a2bb936650b1a78` |
| [Evidence manifest](qualification/performance-manifest.json) | `861f7336aaf929211e8c43e692922a0ee6cfe2c68072455697e075dbb2e7fe58` |

The receipt retains exact outer argv, working directory, selected environment,
clean source identities before/after, and before/after resource-wrapper/driver/
measurement/workload hashes. `cohort.json` retains each child argv, chronological
order, timestamps and comparison. Every report retains source input, fixture,
CoreLib capture where used, harness and Node binary identities.

## Existing controls

Each cell shows **baseline → candidate (change)**. Units are **microseconds per
workload invocation, calculated as batch means**. The median and p95/p99 are
statistics of those batch means, not individual-invocation latency distributions.
Each raw batch contains 1,000 invocations; its duration in milliseconds has the
same numerical value as its mean in microseconds per invocation. Values below
are rounded for reading; every original floating-point value is retained.

| Control | Median, µs/batch-mean invocation | p95, µs/batch-mean invocation | p99, µs/batch-mean invocation |
|---|---:|---:|---:|
| Add_0_0 | 3.093774 → 3.018498 (-2.433%) | 4.701564 → 3.483292 (-25.912%) | 5.040472 → 4.858685 (-3.607%) |
| Diamond | 3.453393 → 3.669061 (+6.245%) | 3.970363 → 5.766667 (+45.243%) | 4.307039 → 6.932706 (+60.962%) |
| MixedJoin | 17.301331 → 18.924581 (+9.382%) | 24.121002 → 32.910650 (+36.440%) | 24.300987 → 54.542570 (+124.446%) |
| ExistingAuthority | 9.336505 → 8.500994 (-8.949%) | 14.436865 → 13.985661 (-3.125%) | 17.688413 → 14.643810 (-17.212%) |
| LoadOwner | 26.824984 → 31.509431 (+17.463%) | 40.804830 → 44.344276 (+8.674%) | 71.692738 → 45.322104 (-36.783%) |
| StoreReferenceDerived | 27.753391 → 27.223575 (-1.909%) | 40.008626 → 49.088979 (+22.696%) | 43.732203 → 85.714732 (+95.999%) |
| StringReturn | 2.218203 → 3.938984 (+77.575%) | 2.546125 → 4.514461 (+77.307%) | 2.651420 → 7.000947 (+164.045%) |
| LocalAddressRoundtrip | 3.890794 → 4.162799 (+6.991%) | 4.558155 → 7.250776 (+59.073%) | 5.001588 → 7.630255 (+52.557%) |
| LoadWideInteger | 9.468861 → 9.519991 (+0.540%) | 10.721313 → 15.383211 (+43.483%) | 12.433431 → 19.508495 (+56.904%) |

The five median threshold exceedances are Diamond, MixedJoin, LoadOwner,
StringReturn and LocalAddressRoundtrip. StoreReferenceDerived and LoadWideInteger
also have adverse tails despite medians below the 5% threshold. The exception
retains all of these results, including favorable statistics, without selecting
only the medians. The largest relative median increase, StringReturn, is an
absolute increase of **1.7207805 µs per workload invocation** in batch means.
LoadOwner's absolute median increase is **4.6844475 µs**; the other exceeding
medians increase by 0.215668 µs (Diamond), 1.62325 µs (MixedJoin) and
0.2720045 µs (LocalAddressRoundtrip).

## Added capability costs

These candidate-only workloads measure successful object verification. They are
not speedups against older unsupported results. Units and batch-mean percentile
interpretation are identical to the control table.

| Workload | Median, µs/batch-mean invocation | p95, µs/batch-mean invocation | p99, µs/batch-mean invocation |
|---|---:|---:|---:|
| NewClass | 32.924082 | 47.428255 | 58.247031 |
| NewArguments | 35.678971 | 42.625090 | 52.894158 |
| BoxValue | 31.847035 | 49.627563 | 53.548250 |
| HarmlessAnnotation | 36.340221 | 56.268027 | 61.875563 |
| UnboxFieldRead | 33.300494 | 52.831872 | 58.928455 |
| RepeatedConstructor | 94.835586 | 119.161849 | 126.172728 |

RepeatedConstructor verifies a method containing **128 constructor/pop pairs**
per workload invocation. Its numbers are for the whole verification, not a
single constructor operation.

## Guard and sample accounting

Every report contains 121 chronological batches: one first batch, 20 warmups and
100 measured batches. Across 24 reports this is **2,904 retained batches**, with
**2,400 measured batches** and **2,904,000 guarded workload invocations**. Every
batch records 1,000 checked results. The first batch mixes the first invocation
with subsequent warm calls, so it is not an individual cold-latency measurement.

The driver retains each batch's bounded result array and checks every result
outside timing. Expectations include the intentionally rejected MixedJoin
control; successful guards are not a claim that every workload returned
`verified`. Even-count median uses the mean of both middle sorted values; p95/p99
use nearest rank. Independent read-only recomputation reproduced all statistics,
phase/sample counts, serial order, source/harness/Node hashes and paired fixture,
capture and checksum equality. It did not execute the product or rerun a test.

The reports preserve chronological raw `heapUsed` deltas. These reflect retained
result arrays, possible collections and other heap behavior; **they are not
allocation counts**. They establish no causal explanation for latency changes.
No heap observation, host characteristic or timing fluctuation is used to dismiss
the adverse performance measurements.

## Source review and remaining scope

The product diff from the controlled baseline changes eight files. Common-path
changes are six new opcode registrations, expanded non-integer condition kinds,
readonly-pointer comparison support and one boxed-target identity guard. The new
object facts/annotation preparation is reached only through new object handlers.

StringReturn's literal preparation, decoded cache, primitive signature/return
assignment and stack/worklist code are unchanged. It reaches no added object
preparation, metadata scan, per-invocation object allocation or duplicate pass.
The opcode registry has additional entries; this source review does not prove
that runtime code generation or lookup cost is unchanged. It establishes no
specific cause for the observed 77.575% median increase.

LoadOwner's exact receiver and integer result assignments short-circuit before
the new boxed-target relation guard. Diamond/MixedJoin use integer conditions,
which short-circuit the expanded non-integer set. The memory controls do not use
the broadened pointer comparison. StoreReferenceDerived reaches one required
boxed-target guard without a new loop/allocation; its median improves while tails
increase. No concrete avoidable source work was identified on regressing paths,
so no speculative optimization was made.

The prior native capture remains unchanged at SHA-256
`038da3f3ca12b21f39c367f726b972b0b89ded606ed66f9157ebeab495996dbb`.
Its 52 observations, initial 79-pass/1-failure focused record, and separate
8-pass correction/replay record retain their original source scopes. This
performance/evidence step ran no additional tests or native captures. Browser
and broader runtime execution qualification remain unclaimed; the object/lifetime
parent and constructor/generic/exception follow-ups are not closed by this review.
