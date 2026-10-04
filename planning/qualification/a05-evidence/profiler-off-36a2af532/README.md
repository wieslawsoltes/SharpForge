# Published36 profiling-off observations

Measured public revision: `36a2af53287a563fd47d3a33b8e6e6382a726d35`.
Exact-parent hook-free reference: `6f26b84f46053b4aafd3ab8e77150cc793790d8d`.

**All six required off rows completed; every acceptance decision is inconclusive.**
These data do not establish the below1% profiling-off requirement.

| Row | Observed overhead |95%paired-bootstrap interval | Decision |
|---|---:|---|---|
| profiler-off-source-arith | -0.007853821% | [-9.825288190%, 6.333206122%] | inconclusive |
| profiler-off-source-calls | 2.295214037% | [-4.725954573%, 10.182401407%] | inconclusive |
| profiler-off-source-allocation | 2.465393241% | [-3.956316939%, 8.134528526%] | inconclusive |
| profiler-off-cil-arith | 0.377981021% | [-5.350254755%, 6.572199843%] | inconclusive |
| profiler-off-cil-calls | 0.266225963% | [-3.160247339%, 3.916204184%] | inconclusive |
| profiler-off-cil-allocation | -0.219583742% | [-1.305788559%, 3.486285300%] | inconclusive |

The unchanged protocol used100 measured pairs,10warmup pairs and1first-execution pair
per mode for each row, ABI64, seed12012,10000resamples, and1800-second timeout.
All111observations per mode remain in the raw report. Every output and paired
instruction count passed. There were no execution errors, retries, omitted off
rows or discarded observations. Exit2 records the inconclusive decision.
The outer journal spans2026-10-04T20:04:24.958042Z to20:14:24.992800Z,600.035seconds.

The reference generator changed only15reviewed profiling consumers. Both VM
class files and shared heap allocation callbacks are byte-identical to product.
The loaded reference runtime classes were explicitly verified to differ from
the product API, preventing dependency links from redirecting the oracle.
Exact parent, complete patch, transformed-file hashes, dependency inventory
and clean worktrees were validated before and after the run. All4620materialized
product and reference tracked files matched their respective commits afterward.
The full patch and its SHA256 are retained, and the reference commit is protected
by branch codex/a05-profiler-reference-historical-36.

Historical312 reference e519 and its archived patch were verified before only
its clean reproducible checkout was removed. Its protected branch and historical
proof remain. historical-reference-retirement.json records that bounded removal.

Generation, validation and measurement used node scripts/limited.js with
SHARPFORGE_TEST_CONCURRENCY=1, SHARPFORGE_MAX_PARALLEL_RUNS=1 and
SHARPFORGE_MAX_OLD_SPACE_MB=512. Exact argv/resource environment and actual
host/Node/V8/heap provenance are retained in journals/raw report.

All six enabled-profiler rows were deliberately omitted; their overhead is
still required separately. profilerCoverage.complete=false reflects that
broader off+on scope, while requiredOff.missing/omitted are both empty.
No browser or native CLR qualification is inferred. This is current36 diagnostic
evidence; affected final acceptance must be measured again after further runtime
optimizations. Earlier312 measurements and the priority36target batch are separate.

report-validation.json checks the completed raw report without rerunning guests.
checkout-before-profiler.json copies the verified post-priority product state,
before reference creation. Raw files are unchanged; SHA256SUMS.json records them.
