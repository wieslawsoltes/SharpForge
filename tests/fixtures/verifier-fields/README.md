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

Qualification is pending the root-owned serial slot. No result is claimed yet.
Planned sequence, with explicit Node 24 PATH, concurrency 1 and 1,024 MiB heap:

```sh
node scripts/limited.js node tests/fixtures/verifier-fields/capture.mjs /tmp/field-native.json
node scripts/limited.js node --test tests/a03-field-transfers.test.js tests/a03-field-ancestry.test.js tests/a03-field-native.test.js
```

The serial driver will include affected numeric/local-initialization/category/
member/type-relation tests, Chromium/Firefox/WebKit source-module runs, isolated
baseline failure and fixed existing/new workload measurements, then static,
manifest and structure checks. Baseline imports its own CIL source; candidate
files are never overwritten. Preserve all first attempts and all raw samples.
The fixed schedule is 120 raw samples: three existing numeric controls plus
existing authority construction, 12 samples each for baseline and candidate;
two newly supported field workloads, 12 candidate samples each. New field costs
are added-capability measurements, with no timing comparison to an old unknown result.
Execution-engine admission, native/Wasm execution and full object-model/constructor
qualification remain open under #2403/#2405.
