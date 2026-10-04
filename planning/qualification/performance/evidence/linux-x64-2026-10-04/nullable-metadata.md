# SF-A02-T05.3 nullable metadata qualification

## Scope and provenance

This batch preserves nullable annotations through source symbols, metadata emission and import. It covers
declaration contexts, type uses, nested generic types, arrays, pointers/function pointers, nullable value wrappers,
generic constraints (including inherited overrides), ordinary record contracts, and the return/parameter and
relation rows that carry their transforms. The related SF-A02-T08.4 fixture covers tuple names on base types,
interfaces, constraints and events, including synthesized event accessor parameters.

The missing-contract path supplies complete compiler-owned `NullableAttribute`, `NullableContextAttribute` and
`Microsoft.CodeAnalysis.EmbeddedAttribute` definitions. Constructor references resolve to actual existing symbols
or local MethodDefs. Existing source contracts are reused; malformed declarations produce an emission diagnostic.

The recorded reference toolchain is SDK 10.0.201, Roslyn 5.3.0-2.26153.122
(`4d3023de605a78ba3e59e50c657eed70f125c68a`), with Microsoft.NETCore.App.Ref 10.0.5 for net10.0.
The fixtures and their complete capture commands/hashes live in `tests/fixtures/nullable-metadata/`.

The missing-contract oracle is an actual Roslyn compilation using a temporary copied `System.Runtime.dll` in
which the first character of the two nullable attribute TypeDef names is changed. It preserves every metadata
offset and records the original and projected reference hashes. The installed reference is never modified.
This tests missing contracts on a controlled modern reference projection; no historical SDK qualification is claimed.

| Roslyn assembly | Bytes | SHA-256 |
| --- | ---: | --- |
| NullableMetadata.dll | 11776 | `8a4d59f13b93915f5ba66cb24f06e725254947cde53d5af5b476a81e7dfb4517` |
| TupleMetadata.dll | 5120 | `bc4c2b8a4f0137ec255f70fc55cdccf4b1e78c44ec3bbd14a5c26c9e85fde3c1` |
| LegacyNullableMetadata.dll | 12288 | `99faeb64a5ad3010c236501ae87b27674af911d43f130dcb4217a8c116eac393` |

## Correctness results

All 23 focused tests passed with no skips in the metadata composition before publication isolation, using
implementation `04f236d9a33b3524ac54258e9ed7bf7beff3c57a` and the fixture/test payload committed as `b25520c2`.
The six test files cover shared
transform/source-context handling, modern emission/import, native reflection, tuple relation metadata, embedded
definition metadata, and native embedded constructor/consumer behavior. Both `compileToAssembly` and
`compileToReferenceAssembly` preserve the qualified signatures. Native execution was on Linux x64 using the
recorded .NET toolchain; this is not a cross-platform runtime qualification claim.

The embedded tests compare the actual type/field/constructor flags and signatures and definition custom-attribute
blobs with Roslyn. Native execution checks scalar construction, preserving the provided byte-array reference,
accepting a null array, reading the context flag, and instantiating the marker/usage attributes. Both modern and
missing-contract native probes compare `NullabilityInfoContext` output and Roslyn consumer warning sets, including
CS8714, CS8634 and CS8631. A separate earlier bounded adjacent run passed 49 tests, including the eight shared
transform tests; that count must not be added to 23 as if all cases were distinct.

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-nullable-metadata-flags.test.js \
  tests/compiler-nullable-metadata.test.js \
  tests/compiler-nullable-metadata-native.test.js \
  tests/compiler-nullable-embedded.test.js \
  tests/compiler-nullable-embedded-native.test.js \
  tests/compiler-tuple-relation-metadata.test.js
```

Set `DOTNET_ROOT` and `DOTNET` to the recorded SDK to reproduce the native checks. Fixture generation is a separate,
intentional operation through `build-fixture.mjs` and `build-legacy-fixture.mjs`; tests never manufacture an oracle.

## Before/after performance

The paired benchmark compares exact baseline `8430a31399ce2cd473b17652c301028bfea610f1` with
`347a37dffa34dcdb87cc1b734d2cbc8de3b7405d`. The baseline predates nullable emission and source annotation preservation.
It was materialized in a clean 8.4 MB sparse checkout containing the compiler's ten transitive workspace packages
and its own package links, then removed after measurement. There were no source edits in that baseline.

Both revisions compile the same `NullableMetadata.cs` with the same name, library/unsafe options and
`portablePdb: false`. The host was Node v24.19.0 on Linux x64, AMD EPYC 9V74, with nine visible logical CPUs and
10,451,464,192 bytes of reported RAM. The project limiter was used, and no other project validation job was running
during measurement. This is a shared hosted machine, not dedicated laboratory hardware.

The four revision/mode combinations receive 80 interleaved warmups each, followed by 20 measured rounds that
rotate which case runs first. Each compiler revision decodes the same reference bytes into its own symbol classes.
The `cachedReferences` mode uses a warmed reference set of 167 assemblies; reference reading, decoding and initial
cross-assembly binding are excluded from timed compilation. All warmup timings and measured samples are retained
in `nullable-metadata.json` beside this note.

| Binding mode | Median before | Median after | Median change | p95 before | p95 after | PE before | PE after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Modeled framework registry | 11.510 ms | 13.251 ms | +15.12% | 17.855 ms | 20.613 ms | 9216 B | 10240 B |
| Cached real references | 12.459 ms | 14.306 ms | +14.83% | 22.264 ms | 19.000 ms | 9216 B | 9728 B |

The median increases are 1.741 ms and 1.847 ms respectively. The registry image grows by 1024 bytes (+11.11%);
the real-reference image grows by 512 bytes (+5.56%). The single-run p95 values are recorded as observations,
without claiming a general tail-latency improvement for the reference mode.

Observed median end-minus-start heap deltas per compilation are 6,684,788 to 7,400,700 bytes for the registry and
7,054,344 to 7,667,620 bytes for cached references. Corresponding ArrayBuffer deltas are 148,897 to 197,572 bytes
and 148,897 to 182,757 bytes. These samples include natural garbage collection and are not total allocation
counters. After explicit collection before and after the measured rounds, combined retained heap and ArrayBuffer
deltas were negative; this does not establish an allocation or memory-retention improvement.

```sh
node scripts/limited.js node --expose-gc packages/compiler/bench/nullable-metadata.bench.js \
  --baseline /path/to/exact-8430a313-checkout \
  --output planning/qualification/performance/evidence/linux-x64-2026-10-04/nullable-metadata.json
```

## Budget and interpretation

Both median increases exceed the normal 5% budget, and registry output growth exceeds 10%. This is a documented
correctness cost that requires explicit acceptance in the pull request; it must not be described as a performance
pass. The baseline omitted nullable transforms and attribute/context metadata, so removing that new work to recover
the old result would lose the qualified annotation semantics. Traversal is linear in each encoded type shape, and
requirements are collected before token allocation so attributes are not synthesized repeatedly while writing rows.

The comparison measures complete revisions. It also includes intervening attribute-target, PDB, extension-import,
dynamic and union changes listed by commit in the raw report. PDB emission was disabled in both measurements, but
the report does not isolate every other integration change. It therefore quantifies the observed complete-revision
cost and does not attribute the entire difference to one nullable helper or claim an unmeasured optimization.

Implementation-author sign-off: the quantified median and registry-size increases are accepted as a correctness
exception for this batch. Preserving the qualified source annotation meaning, emitting resolvable contracts and
retaining native consumer parity take precedence over the baseline that omitted that metadata. This acceptance
does not certify a performance-budget pass or waive measurement of future changes.

## Publication scope

The isolated publication branch is based on the attribute metadata dependency at
`a72246a65dad50ea458ff5938fc88a77c9e06565`. It preserves the owned source/test batches as separate commits and
adapts only the nullable, tuple and compiler-attribute composition hooks. The benchmark above remains evidence for
its explicitly recorded complete revisions; it is not relabeled as a run on the isolated branch. Independent replay
of that isolated branch must be recorded separately.

The only manifest change outside the compiler workstream is the exact path/count/SHA-256 entry for
`packages/compiler/bench/nullable-metadata.bench.js` in `scripts/conformance/static/allowlist.json`. It reviews the
single dynamic import of the fixed compiler package entry from an operator-selected trusted checkout. The checker
and all other policy entries remain unchanged by this batch.
