# A05 double-loop per-iteration allocation criterion

Issue [#1395](https://github.com/wieslawsoltes/SharpForge/issues/1395) permits a
`--trace-gc` measurement for the requirement that a double-heavy loop allocate
zero JavaScript objects **per iteration**. The requirement also needs passing
float differential tests. Neither zero allocation for an entire process nor an
exact counter for every possible host allocation site is required by that clause.

The allocation driver retains both kinds of evidence. Its original
`assessment.totalJSObjectAcceptance` stays `unqualified`, and its standalone
report stays `partial` because it does not run the float differential suite.
The additive `perIterationAllocationCriterion` assesses the original allocation
clause for the two specified warmed direct-CIL loops on the recorded Node/V8
engine. A `met` result is limited to that measured workload and environment; it
does not qualify other programs, source execution, browsers, native engines or
Wasm.

The fixed protocol uses 100,000 warmup iterations in ten real slices, followed by
separate 100,000- and 1,000,000-iteration measurements. Each iteration executes
exactly eleven guest instructions and adds the exactly representable value 0.25.
The driver also measures zero-iteration entry/exit controls and a generic
10,000-iteration positive allocation control. No fixture, sample count or byte
tolerance changes as part of this assessment.

A synchronous collection precedes the begin marker. Every collection between
the begin and end markers contributes its `allocated` bytes, as does the first
collection after the end marker. The latter reports allocations **before** that
collection, including the uncollected final interval. Post-collection retained
heap size is not used as an allocation proxy. Fixed marker and slice entry/exit
work remains included; its exact allocation sites are not claimed to be known.

The criterion assessment requires matching engine and instrumentation identities,
exact protocol and instruction counts, verified outputs, and a generic control
that detects allocations. Both loop variants must have zero float-carrier,
managed, frame and frame-array allocation counts and no in-loop collections.
Increasing the measured guest work tenfold must not increase the measured
interval bytes. The report preserves both absolute bytes and bytes above the
zero-iteration control. It applies no noise allowance: one additional observed
byte makes the trace assessment inconclusive. A positive exact loop allocation
counter is a miss; incomplete or mismatched protocols are unqualified.

The unchanged historical
[warm10 report](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/float-allocation-2026-10-04/a05-float-allocation-single-boundary-warm-slices.json)
at `b0b1a20db65f36b5c6985f90237914613d037a7f` recorded these absolute interval bytes:

| Loop | 100,000 iterations | 1,000,000 iterations | Additional bytes |
|---|---:|---:|---:|
| Double induction | 28,608 | 28,608 | 0 |
| Int32 induction with double arithmetic | 32,712 | 30,984 | −1,728 |

Both zero-iteration controls recorded 664 bytes. Both measured loop variants had
zero in-loop collections and zero exact carrier/storage counters; the generic
control detected 70,000 carriers. This supports no recurring iteration-dependent
allocation on those warmed loops using the issue's permitted GC-trace method.
The original report and its `partial` label remain unchanged. Its raw traces,
hashes and earlier measurements are retained in the
[evidence directory](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/float-allocation-2026-10-04/README.md).

A fresh revision requires fresh evidence. Run serially from a clean committed
checkout, use a new output path, and retain the JSON and all seven adjacent raw
trace logs:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node bench/vm/float-allocation.js \
  --runner a05-linux-x64-node24 --warmup-slices 10 --warmup 100000 \
  --iterations 1000000 --out /tmp/a05-final-evidence/REVISION/float-warm10.json
```

Each child receives `--max-old-space-size=512 --expose-gc --trace-gc-nvp`. The
driver refuses to overwrite evidence, records clean start/end revisions and
instrumentation hashes, and exits 2 for its standalone partial qualification.
Read `perIterationAllocationCriterion.acceptance` for the allocation clause and
attach revision-matched float differential results separately. Running this
command alone does not establish a passing result.
