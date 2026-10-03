# Nested metadata type-name lookup

`readMetadata(...).typeName(token)` lazily builds one NestedClass child-to-parent Map
for each parsed reader. Index construction is O(NestedClass rows); each enclosing-type
lookup is O(1), and complete name construction remains O(nesting depth + string length).
The existing 64-level recursion limit and TypeSpec decoder depth parameter are preserved.
The cache holds only the nested-row index, so formatted-name caching cannot bypass depth
checks. TypeRef/TypeSpec-only users do not pay for a NestedClass index.

Duplicate child mappings and invalid TypeDef indexes now report CilError when the index
is first needed. Cycles retain the bounded recursion diagnostic. Reader table arrays are
parsed metadata snapshots; use MetadataBuilder and parse again after changing metadata.
No index is shared across readers and there is no global cache.

The deterministic regression counts NestedClass row visits through an instrumented array:
1,000 distinct nested names must cause at most 2,000 visits, then reuse the index. This
reproduces the original quadratic scan without relying on timing assertions in CI.

A dedicated benchmark constructs a fresh parsed reader for every sample and times only
its first pass naming every nested TypeDef. Parsing/fixture generation is outside the timed
region. It records seven samples, median/p95 time and sampled heap delta. Run serially:

```sh
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-type-names.mjs LABEL 1000,5000,200000 OUTPUT.json
```

The original implementation is measured only at 1,000/5,000 types to bound its quadratic
work; the optimized reader is additionally measured at the issue's 200,000-type target.
Measured on Apple M3 Pro (Mac15,6), macOS ARM64, Node 24.21.0, through the serial limiter with no other local
validation running. Baseline metadata.js is pinned to 62126153; indexed source is d00d2aa2.
The baseline deterministic regression fails at 1,500,500 row visits; the indexed reader
visits only 1,000 rows and then reuses its Map. All 206 focused/CIL/signature/SRM tests pass.

| Nested types | Baseline median / p95 ms | Indexed median / p95 ms | Baseline / indexed sampled heap delta |
| --- | --- | --- | --- |
| 1,000 | 7.6609 / 7.8955 | 0.5436 / 1.1258 | 791520 / 824128 bytes |
| 5,000 | 176.2776 / 188.2372 | 1.7860 / 2.1177 | 3622280 / 3271704 bytes |
| 200,000 | Not run (quadratic work bounded) | 99.4920 / 109.8101 | Not run / 73907832 bytes |

All seven 200,000-type samples finish below 110 ms, satisfying this host's one-second
acceptance target. Heap deltas include cached decoded strings, the index and temporary
allocations; they are sampled deltas, not peak or retained-memory measurements. Raw samples
are pinned in `type-names-before.json` and `type-names-after.json`. No browser, other-machine
or baseline 200,000-type timing is claimed; broader platform qualification remains staged.
