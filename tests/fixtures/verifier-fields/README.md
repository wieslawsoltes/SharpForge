# Normal field-transfer fixture

`input.js` independently emits ordinary CLI definitions/fields/method bodies;
`cases.js` declares positive, negative and unsupported cases before qualification.
The tests bind its Object/ValueType references to canonical handles replayed from
the retained actual CoreLib metadata in `a03-type-categories/native.json`
(SDK 10.0.201 / CoreCLR 10.0.5). Browser tests use portable synthetic canonical
authority contracts. No name heuristic exists in product classification.

The native capture runs the exact emitted bytes through pinned ILVerify 10.0.5,
retaining every stdout/stderr/exit result, input hash and reference/tool version.
It compares receiver identity, class/value forms, static/instance access,
visibility, primitive/reference type confusion, init-only rules, normal class
and value instance methods, static constructors, and nominal locals/returns/joins.
`StoreValueCopyUnknown` is deliberately unsupported despite native acceptance.
`AddressInitOnly` declares the ECMA/ILVerify difference before execution.

Qualification passed at `b79c8b9aec47f549d513f1b1afe88bdc36c63669`, with CIL
product unchanged from `4ffe1d87d`: 127/127 focused/affected tests, all 40 pinned
ILVerify observations matching their declared expectations, and 46 checks each
in Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6. Static checks covered
3,667 syntax / 3,663 import modules with no errors; manifests had no unassigned
or duplicate files. Structure reported 272 existing findings and none owned by
this change. Node 24.21.0, concurrency 1 and a 1,024 MiB heap were explicit.

Reproduction entry points:

```sh
node scripts/limited.js node tests/fixtures/verifier-fields/capture.mjs /tmp/field-native.json
node scripts/limited.js node --test tests/a03-field-transfers.test.js tests/a03-field-ancestry.test.js tests/a03-field-native.test.js
```

The [retained serial drivers and raw evidence](qualification/) include affected
numeric/local-initialization/category/member/type-relation tests and an isolated
baseline at `594085da9`. Each worktree installed its own dependencies and imported
its own CIL source. Source/input/link hashes were checked before and after;
candidate files were never overwritten for baseline measurement.
The fixed schedule is 120 raw samples: three existing numeric controls plus
existing authority construction, 12 samples each for baseline and candidate;
two newly supported field workloads, 12 candidate samples each. New field costs
are added-capability measurements, with no timing comparison to an old unknown result.

On shared Apple M3 Pro / macOS 26.6, existing `Add_0_0` median increased
2.402708 → 3.354583 ms per 1,000 calls (+39.6168%, +0.951875 µs/call); p95
3.452917 → 5.787500 ms (+67.6119%, +2.334583 µs/call). Root explicitly accepted
this quantified cost for bounded registered-transfer/canonical relation
integration in [the acceptance record](qualification/performance-acceptance.json).
Other observed median/p95 controls, in ms per 1,000 calls: Diamond
2.611500/4.327625 → 2.163083/3.920709; MixedJoin
14.920959/17.391000 → 13.194792/14.199875; existing authority construction
4.749417/7.253500 → 4.799709/6.639834. New field load and reference-store workloads
cost 17.373208/19.564625 and 15.911166/20.891416 respectively. These are batch
statistics, not individual latency percentiles. No causal/noise/speedup claim
is made; retained heap deltas are neither allocations nor peak memory.

Three first-attempt failures remain preserved: the expected-before assertion
was correctly emitted on stderr while the initial driver checked stdout; native
tool paths were initially unset and no oracle ran; then the focused suite passed
126/127 with one wrong expected diagnostic phase. Existing inspector decoding
rejects the malformed byref field signature as CILT0001/InvalidMetadata before
member adaptation. The corrected test preserves rejection and asserts the exact
reason. Only unfinished stages resumed; no native process or benchmark was repeated.

Execution-engine admission, native/Wasm execution and full object-model/constructor
qualification remain open under #2403/#2405.
