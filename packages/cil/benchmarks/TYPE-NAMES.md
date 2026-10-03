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
Baseline/current measurements and focused validation are pending the scheduled slot.
