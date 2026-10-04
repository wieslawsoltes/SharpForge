# Source Fibonacci qualification after prepared frame recycling

Both reports measure the unchanged `source-fibonacci` target at clean revision
`48c62243ef4cf614dfcafdb7af9a7ce360b643c4` on Linux x64, Node 24.19.0,
V8 13.6.233.17-node.51, AMD EPYC 9V74. They are source JavaScript VM measurements
with a 64-bit guest native-integer ABI; they do not qualify native CLR or browsers.
The reports include exact environment, assembly and harness fingerprints,
construction/preparation costs, warmups, raw alternating observations, output
verification, allocation counters and the unchanged 1.5× target decision.

| Observations per mode | Baseline median / p95 ms | Candidate median / p95 ms | Speedup | 95% paired interval | Decision |
| --- | --- | --- | --- | --- | --- |
| 20 | 57.9295 / 83.2327 | 39.1234 / 53.6136 | 1.48069× | [1.34064, 1.60855] | Inconclusive; point below target |
| 100 | 56.8419 / 84.9704 | 38.5948 / 64.1105 | 1.47278× | [1.41347, 1.52400] | Inconclusive; point below target |

The 100-pair repeat was selected after the first inconclusive result to reduce
uncertainty. It retained the same revision, fixture, options, threshold, three
warmup pairs, 10,000 resamples and seed 12012. Both complete reports are retained;
neither is selected as a passing result. Issue #1394's Fibonacci target remains
unqualified. Both modes reported zero warm managed allocations, frame allocations
and frame-array allocations in every measured observation.

The baseline sets `sourceFusion:false`; the candidate sets `sourceFusion:true`.
Each mode retains one prepared VM. Host GC runs before each complete warm
observation; guest execution retains managed GC and existing 10,000-instruction,
8 ms slices. No options, source program or reference were changed between runs.

The command was run through the repository's machine-wide limiter with:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/qualification.js \
  --runner a05-linux-x64-node24 --native-bits 64 \
  --suite targets --target source-fibonacci \
  --out /workspace/scratch/42f7738360b9/a05-fibonacci-48c62243.json
```

The repeat adds `--samples 100` and writes the separate `-100.json` path. Both
commands exited 2 because qualification was inconclusive, with no runtime or
measurement errors. The repeat initially waited for the shared run slot occupied
by another workspace; the unchanged limiter admitted it naturally. No locks or
other processes were changed. The A05 agents scheduled no competing heavy jobs.

The accompanying pool/fusion/index regression log records **122/122 passing**
tests across 11 files, including all seven new prepared-frame tests. It covers
capability forgery and stale metadata/pools, shared-image VM isolation, deferred
roots, pin revocation, late fields, deleted/nonenumerable fields, inherited
getters, array identities, retention budgets and ordinary execution parity.
The remaining files cover source/reloaded recursion, quotas, fault contexts,
partial slices, observers, code invalidation, snapshots and live frame indexing.

`manifest.json` records the byte counts and SHA-256 values of the original JSON
reports and logs. They are byte-for-byte copies; this README adds interpretation
without editing their recorded observations.
