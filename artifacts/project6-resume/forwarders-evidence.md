# CLR forwarder qualification and performance evidence

This record accompanies SF-A04-T06.2. The integrated implementation was frozen at
`5fb495f73`; the measurement-tool change is `ae5ee23b785269928577425576e17e520928d06c`.
The tool change does not edit runtime product code. All existing raw benchmark
cohorts are retained, including cohorts with an ineffective correctness guard and
cohorts that report regressions. [forwarders-evidence.json](forwarders-evidence.json)
indexes their paths, SHA-256 hashes, source commits, guards, and recomputed statistics.

## Retained correctness evidence

| Evidence | Observed result | Scope |
| --- | --- | --- |
| [Integrated focused run](forwarders-integrated-tests.tap) | 8 tests passed; 0 failed, cancelled, or skipped | Three forwarder files after the main merge at `5fb495f73`: forwarding behavior, native replay, and cache publication capacity |
| [Earlier optimized run](forwarders-optimized.tap) | 21 tests passed; 0 failed, cancelled, or skipped | Earlier forwarder/type-graph/type-identity/lookup qualification; its log does not embed the execution HEAD |
| [Earlier final run](forwarders-final.tap) | 19 tests passed; 0 failed, cancelled, or skipped | Retained preceding implementation run |
| [Initial run](forwarders.tap) | 18 tests passed; 0 failed, cancelled, or skipped | Retained initial implementation run |
| [Native observations](../../tests/fixtures/clr-forwarders/native-forwarders.json) | 10 cases; SDK `10.0.201`, CoreCLR `.NET 10.0.5` | `Assembly.GetType` and `Module.ResolveType` observations on seven hashed PE images; successful names, nested types, canonical identity, cycles, and missing names |

The native fixture retains observer/fixture source hashes and every image hash.
Its reference test compares the host JavaScript loader's results with those
observations. The original [capture log](native-forwarders.log) and
[later capture log](native-forwarders-final.log) remain available. No new native
process was executed while preparing this evidence record. The `.tap` filenames
are historical; these retained files contain Node's readable test reporter output.

The integrated run covers `tests/clr-types-forwarders.test.js`,
`tests/clr-types-forwarders-cache.test.js`, and
`tests/clr-types-forwarders-reference.test.js`. The broader earlier runs remain
distinct; their test counts are not added to the latest run or represented as a
new full-suite result.

## Existing lookup benchmarks: all cohorts retained

Every run below reports Node `v24.19.0`, Linux x64, an AMD EPYC 9V74 80-Core
Processor, and `sharedMachine: true`. Allocation counts were not measured.
Each raw JSON file preserves chronological sample values and the driver's
original summaries; each matching `.log` preserves its console summary.

Baseline commit: `8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c`.

| Cohort and raw JSON | Candidate | Sampling | Qualification |
| --- | --- | --- | --- |
| Original 1: [before](forwarders-before-1.json), [after](forwarders-after-1.json) | `473632fc2e236d75bcfb02cc1ff92f9e0ab880b1` | 3 warm batches, 12 measured; 2,000 warm lookups or 20 cold operations per batch | **Unqualified correctness guard** |
| Original 2: [before](forwarders-before-2.json), [after](forwarders-after-2.json) | `473632fc2e236d75bcfb02cc1ff92f9e0ab880b1` | Same original driver and batch counts | **Unqualified correctness guard** |
| Fixed guard: [before](forwarders-fixed-before.json), [after](forwarders-fixed-after.json) | `1e9d57f57649e728c945a2c296432f92c6f3f125` | 3 warm batches, 12 measured; 2,000 warm lookups or 20 cold operations per batch | Exact `metadataToken` and `fullName` guard |
| Steady: [before](forwarders-steady-before.json), [after](forwarders-steady-after.json) | `1e9d57f57649e728c945a2c296432f92c6f3f125` | 5 warm batches, 15 measured; 50,000 warm lookups or 100 cold operations per batch | Exact guard |
| Lazy state: [before](forwarders-lazy-before.json), [after](forwarders-lazy-after.json) | `d5b9e365f2b8fc4d05c7f35b4e9eaef8dcb992bf` | 5 warm batches, 15 measured; 50,000 warm lookups or 100 cold operations per batch | Exact guard |
| Cold 100: [before](forwarders-cold100-before.json), [after](forwarders-cold100-after.json) | `d5b9e365f2b8fc4d05c7f35b4e9eaef8dcb992bf` | 10 warm batches, 100 measured; 100 cold operations per batch | Exact guard; driver's even-sample median correction below |

The original cohorts compared the obsolete `TypeDesc.token` property. Both
compared properties were undefined, so the guard did not establish descriptor
identity. Those measurements and the original
[comparison](forwarders-comparison.json) are archived as **unqualified**. They
are not used to establish a speedup or a passing regression budget. The later
drivers check `metadataToken` and `fullName` against the native type-graph fixture;
their retained results are qualified for that guard. The
[fixed comparison](forwarders-fixed-comparison.json) is retained unchanged too.

The three current driver sources are retained as text:
[12-sample lookup driver](benchmark-clr-lookup.mjs.txt),
[15-sample steady driver](benchmark-clr-lookup-steady.mjs.txt), and
[100-sample cold driver](benchmark-clr-lookup-cold100.mjs.txt).
These are the repaired driver snapshots. They do not reconstruct the original
pre-repair source or retroactively supply source/fixture hashes to past runs.
The historical reports do retain their actual source commit and host metadata.

## Qualified results and the unresolved regression budget

Values below are microseconds per lookup/operation. Medians are recomputed from
the same retained samples; p95 uses nearest rank, `ceil(n * 0.95) - 1` in the
sorted copy. No raw file is rewritten and no additional benchmark is represented
by these calculations.

| Cohort / operation | Median before | Median after | Median change | p95 before | p95 after | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed / warm token | 0.35194025 | 0.47158100 | +33.99% | 0.43182000 | 0.53755050 | +24.48% |
| Fixed / warm name | 0.55439800 | 0.54974600 | -0.84% | 0.82576400 | 0.59771900 | -27.62% |
| Fixed / cold graph | 282.78515000 | 279.13017500 | -1.29% | 390.50685000 | 438.02260000 | +12.17% |
| Steady / warm token | 0.31238866 | 0.21399506 | -31.50% | 0.61902188 | 0.28038542 | -54.71% |
| Steady / warm name | 0.42376674 | 0.23485632 | -44.58% | 0.58927696 | 0.24905660 | -57.74% |
| Steady / cold graph | 194.29081000 | 215.97574000 | +11.16% | 221.91692000 | 394.18147000 | +77.63% |
| Lazy state / warm token | 0.29756546 | 0.24705932 | -16.97% | 0.48348688 | 0.35948940 | -25.65% |
| Lazy state / warm name | 0.37829062 | 0.28678612 | -24.19% | 0.41403094 | 0.37176462 | -10.21% |
| Lazy state / cold graph | 214.04671000 | 215.68141000 | +0.76% | 245.02529000 | 444.96111000 | +81.60% |
| Cold 100 / cold graph | **235.35997000** | **257.93217000** | **+9.59%** | **373.17226000** | **361.89297000** | **-3.02%** |

The cold-100 driver's original `median` field selected the upper middle sample,
index 50, rather than averaging indices 49 and 50. Its unmodified JSON and logs
therefore report **235.37207000 -> 258.30961000**, a **9.74523%** increase.
The true medians of those same 100 samples are **235.35997000 -> 257.93217000**,
a **9.59050%** increase. Both figures exceed the 5% regression threshold.
The p95 figures are unchanged by this correction.

These cohorts use different batch sizes, warmup lengths, and implementation
commits. Compare each candidate with its paired baseline; do not pool them or
select the smallest result. Shared-machine variation and the shorter cohorts
limit precision. A lower mean or p95 does not negate the final measured median
regression. The observations do not isolate the cost of an individual allocation
or forwarding operation. The cold-100 candidate also precedes the main integration
merge; its source commit remains explicit.

**Performance sign-off is pending.** Section 4 of
[CONTRIBUTING.md](../../CONTRIBUTING.md) requires explicit justification and PR
sign-off for a regression above 5%. This evidence does not infer or grant that
sign-off. The publication owner must record the quantified acceptance separately.

## New-feature benchmark protocol

The forwarder-specific tool was revised before its first run and frozen in
`ae5ee23b785269928577425576e17e520928d06c`. Run it once through the resource wrapper:

```sh
node scripts/limited.js node packages/clr/tools/benchmark-forwarders.mjs \
  artifacts/project6-resume/forwarders-feature.json \
  > artifacts/project6-resume/forwarders-feature.log 2>&1
```

It measures a fresh context admitting prebuilt images through two forwarding
hops, a warm two-hop forwarded lookup, and a warm direct definition lookup. Each
case receives **20 full warm batches and 100 measured batches**. Cold batches
contain 5 operations; warm batches contain 100. Fixture construction and result
validation occur outside the timed spans. Awaiting lookups and retaining every
returned object occur inside them.

Every returned value must be the loaded `ForwardTarget` definition of
`Fixture.Widget`, token `0x02000003`, with the expected defining module and the
module's exact canonical TypeDef object. Warm results must also be the same
pre-established canonical object. All returned tokens contribute to a retained
checksum. No dynamic registry bypass or alternative runtime path is used.

The report retains chronological warm and measured batches with elapsed
milliseconds and normalized microseconds per operation, true median, nearest-rank
p95/p99, validated operation counts, source commit, package source hashes, tool and
fixture source hashes, actual generated image hashes, and host metadata. It
rejects dirty source inputs and records explicit failed reports. Allocation counts
are not measured. This new feature has no previous equivalent implementation;
its measurements do not replace the existing-path regression comparison.

The integration owner ran the frozen tool once on 2026-10-04 at 14:04:32 UTC.
The [raw feature report](forwarders-feature.json) and
[console log](forwarders-feature.log) record `status: passed` at the exact tool
commit above. All three cases retain 20 warm and 100 measured batches. The cold
case validated 600 returned descriptors; each warm case validated 12,000,
including its warmups. Every-result correctness checks succeeded.

| New-feature operation | Median, microseconds | p95, microseconds | p99, microseconds |
| --- | ---: | ---: | ---: |
| Cold context, image admission, two forwarding hops | 259.811900 | 553.615800 | 1431.358000 |
| Warm two-hop forwarded lookup | 0.745495 | 1.687780 | 7.170040 |
| Warm direct definition lookup | 0.908390 | 4.320050 | 17.287320 |

The actual environment was Node `v24.19.0`, Linux x64, AMD EPYC 9V74 80-Core
Processor, with 9 logical CPUs reported. The report marks the machine shared,
does not claim activity isolation, and records no forced GC. The operations have
different cache and admission work; these within-run numbers do not establish a
before/after speedup. The successful result checks also do not sign off the
separate existing-path cold median regression. No repeat run was performed while
preparing this record.

## Platform and feature limits

This batch qualifies the host JavaScript CLR loader service. The retained native
observations provide reference behavior; they do not establish a new source VM,
direct CIL, Rust-native, or Rust-Wasm execution integration. No new browser result
or build-size measurement is retained here.

The API resolves exact metadata names and the supported TypeRef/ExportedType
scopes. Reflection type-name grammar, generic argument syntax,
`Assembly.GetForwardedTypes`, linked netmodule loading, visibility policy, and
engine token adapters remain separate work. See the
[public forwarding contract](../../packages/clr/FORWARDERS.md).
