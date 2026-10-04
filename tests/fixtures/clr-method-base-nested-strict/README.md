# Nested strict override oracle

Independent PersistedAssemblyBuilder source prepares thirteen same-assembly,
nongeneric cases. Expected positives cover private access/widening, skipped lexical
levels, private override chains, inherited private methods, ordinary public/family
overrides and a new slot. Expected negatives cover sibling/external intermediate
bases, an outside child, narrowing and PrivateScope. SRM supplies the nested names
and tokens independently; reflection records GetBaseDefinition or type-load failure.
No fixture method is invoked. SDK 10.0.201/CoreCLR 10.0.5 captured all thirteen
expectations: eight roots and five TypeLoadException failures agree with the loader.

The native test requires the captured source/image hashes from its first scheduled
run; there is no availability skip. Both initial and corrected-source runs passed
21 focused tests and static/structure checks. The corrected run replays the unchanged
capture; original and final 600-sample benchmark sets are retained. The root reviewer explicitly accepted the remaining cold strict-path p95
increase of 2,083.958 µs (+460.755%); complete before/after values and both raw sets
are in `packages/clr/benchmarks/nested-strict-overrides-node24.json`. Source VM/direct CIL/Rust/Wasm
execution and cross-platform qualification are not implied by host reflection.

```sh
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-nested-strict tests/fixtures/clr-method-base-nested-strict/Program.cs
node --test --test-concurrency=1 tests/clr-methods-base-nested-strict*.test.js tests/clr-methods-base-strict*.test.js tests/clr-methods-base-definition.test.js
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-nested-strict/native-method-bases.json --corelib-intrinsics --accepted-records
```

Commands run inside one limiter-owned sequential driver, with test concurrency 1,
one machine run slot and a 1 GiB Node heap. Existing controls use the unchanged
twelve-record strict fixture (eight accepted roots), with each implementation
imported from its own tree. No broad matrix or existing non-strict repeat is planned.
