# Literal verifier performance evidence

The predefined follow-up cohort records Diamond **5.579% slower by median**, above
the repository's 5% existing-benchmark regression budget. This requires an explicit
PR justification and sign-off under CONTRIBUTING.md section 4. No human approval,
exception acceptance or performance gate pass is recorded here. The coordinating
agent owns that assessment. Both the original measurements and the follow-up are
retained; there was no retry-until-pass loop.

## Source revisions and measurement provenance

| Role | Exact revision |
|---|---|
| Baseline, both cohorts | `8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c` |
| Original candidate | `eec64a8bdb047bbd4b56a8ce63ad2cf9bbbd44be` |
| Cache correction and follow-up candidate | `6f775dcad0c3e00a7483fc62226b50c8d9f81ef1` |

All runs used Node 24.19.0, Linux x64, in the shared workspace. The follow-up
[environment record](steady/environment.json) additionally records kernel 6.18.44,
AMD EPYC 9V74, 9 visible logical CPUs, 10,451,464,192 bytes of system memory and
`--max-old-space-size=2048`. Neither cohort establishes a quiet, isolated host.
Raw `heapUsed` deltas include garbage collection; they are not allocations, peak
memory or retained-memory measurements.

[retention.json](retention.json) maps every copied raw artifact to its original
location and exact SHA-256/byte count. Archived `.mjs` files use a `.txt` suffix
without changing their bytes. [source-inputs.json](source-inputs.json) hashes the
original driver and direct fixture/helper source at every measured revision.
Each raw result contains its generated assembly or metadata-row hash. Paired
fixture hashes and the captured CoreLib metadata hash match across revisions.
The original scratch paths in archived manifests are provenance, not portable
checkout paths. No SDK, runtime, assembler or verifier binaries are included.

## Original cohort

The original drivers recorded 12 chronological samples with 1,000 guarded
invocations each. They excluded the first 3 samples and selected measured sorted
position 4 for the median and position 8 for p95. Times below are milliseconds
per 1,000 invocations. Full samples, heap deltas and stdout are in
[original](original/); [original/summary.json](original/summary.json) contains the
unrounded comparison and candidate-only literal costs.

| Existing control | Baseline median | Candidate median | Change | Baseline p95 | Candidate p95 |
|---|---:|---:|---:|---:|---:|
| Add_0_0 | 3.967452 | 6.263697 | +57.877% | 10.813735 | 21.958611 |
| Diamond | 4.159263 | 4.898701 | +17.778% | 6.843779 | 9.948552 |
| MixedJoin | 19.849776 | 19.518679 | -1.668% | 35.463030 | 24.521442 |
| Existing authority construction | 7.572641 | 8.168166 | +7.864% | 11.033002 | 10.935619 |

The coordinating execution owner reported that all original workload guards held.
The retained stdout logs have no invocation preamble or process-exit record, so
the following are replay commands, not reconstructed original command records.
Run them in complete worktrees at the applicable revisions, with distinct output
paths. Both authority controls use `baseline` mode:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-numeric-verifier.mjs /tmp/numeric.json
node scripts/limited.js node packages/cil/tools/benchmark-field-verifier.mjs /tmp/authority.json baseline
```

The literal driver ran only on the original candidate, measuring added capability
costs. An earlier `unknown` result is not a performance baseline for verification.

| Literal workload | Median ms / 1,000 | p95 ms / 1,000 |
|---|---:|---:|
| StringReturn | 4.282584 | 7.089829 |
| Length8192 | 22.878204 | 24.053551 |
| StaticStringStore | 19.683860 | 23.636458 |
| RepeatedToken | 35.354600 | 37.600442 |

```sh
node scripts/limited.js node packages/cil/tools/benchmark-literal-verifier.mjs /tmp/literal-cost.json
```

## Cache correction and follow-up

Source inspection found one concrete additional lookup on each cached typed
verification: public `Map.has`, raw `Map.has`, raw `Map.get`, compared with the
baseline's public `has`/`get`. Commit `6f775dca` replaced those with public `get`
and raw `get`; public-view cache hits now also use one `get`. Cold decoding returns
the newly cached method directly. Both caches contain owned method objects, so
`undefined` remains an unambiguous miss. Public-cache precedence, cache identity,
raw/display separation, promotion eviction and failure behavior are preserved.

Numeric preflight still reads the registered preparation property per instruction
and makes one early-return preparation call per verification. It allocates no
literal bookkeeping or preparation context and performs no second instruction
pass. Field preparation retains its extra pass to validate unreachable operands
after display resolution was removed from typed decoding. The authority control
does not call typed verification or method decoding; its timed type-system source
is unchanged. These observations do not attribute the original timing swings to
the cache lookup or establish the cause of Diamond's remaining difference.

After the correction, the coordinator recorded
[38 passing tests](../cache-correction-node.tap), with zero failures, cancellations
or skips. This exact command is known from the coordinator's execution record,
at `6f775dca` in `sf6-verify`; the raw log itself has no command header:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a03-inspector-method-view.test.js tests/a03-typed-preparation.test.js \
  tests/a03-numeric-transfers.test.js tests/a03-string-transfers.test.js \
  tests/a03-string-metadata.test.js tests/a03-string-budgets.test.js \
  tests/a03-string-native.test.js \
  > /workspace/scratch/7e3d2a445c44/literals-cache-tests.tap 2>&1
```

The predefined follow-up used identical derived copies of the numeric and field
drivers in the two worktrees. It preserved their imports, fixture construction
and guards, adding a single-case numeric selector and changing only the sampling
parameters: 120 samples, the first 20 warmups, 5,000 invocations per sample.
Median is the mean of measured sorted positions 49 and 50; p95 is position 94.
All 4,800,000 invocations kept their original guards. All eight child processes
and the outer wrapper exited zero. These results are milliseconds per 5,000:

| Existing control | Baseline median | Candidate median | Change | Baseline p95 | Candidate p95 |
|---|---:|---:|---:|---:|---:|
| Add_0_0 | 15.808239 | 14.982579 | -5.223% | 25.138560 | 18.583350 |
| Diamond | 17.688238 | 18.675063 | **+5.579%** | 19.889440 | 21.370732 |
| MixedJoin | 86.468509 | 87.761775 | +1.496% | 98.358631 | 106.159966 |
| Existing authority construction | 36.734901 | 37.217009 | +1.312% | 39.640264 | 40.100856 |

The exact order was baseline Add, candidate Add, candidate Diamond, baseline
Diamond, baseline MixedJoin, candidate MixedJoin, candidate authority, baseline
authority. Both authority invocations used `baseline` mode. One outer wrapper
awaited each child before starting the next, with no nested wrapper:

```sh
node scripts/limited.js node /workspace/scratch/7e3d2a445c44/project6-literal-steady/run-cohort.mjs \
  > /workspace/scratch/7e3d2a445c44/project6-literal-steady/cohort.log 2>&1
```

[steady/manifest.json](steady/manifest.json) records the exact driver substitutions
and hashes. [steady/chronology.json](steady/chronology.json) records every child
command, working directory, timestamp and exit status. Archived driver and batch
source, all 120 samples per run, stdout/stderr, and the original artifact inventory
remain in [steady](steady/). [steady/summary.json](steady/summary.json) includes the
unrounded numbers and temporary-file cleanup caveat. No original report was
overwritten. The corrected source and longer sampling changed together; this
cohort does not isolate their individual effects or establish a causal speedup.

Diamond's median difference is 0.986825 ms per 5,000 invocations, or approximately
0.197 microseconds per invocation, and still exceeds the relative 5% budget.
The shared-host caveat does not waive that budget. The PR must state an explicit
justification and obtain sign-off before reporting an accepted exception.
