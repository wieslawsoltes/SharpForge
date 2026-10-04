# Nested strict override oracle

Independent PersistedAssemblyBuilder source prepares thirteen same-assembly,
nongeneric cases. Expected positives cover private access/widening, skipped lexical
levels, private override chains, inherited private methods, ordinary public/family
overrides and a new slot. Expected negatives cover sibling/external intermediate
bases, an outside child, narrowing and PrivateScope. SRM supplies the nested names
and tokens independently; reflection records GetBaseDefinition or type-load failure.
No fixture method is invoked. These expectations remain unqualified until capture.

The native test requires the captured source/image hashes from its first scheduled
run; there is no availability skip. Capture, affected tests, fixed controls and
static checks are pending the root's serial slot. Source VM/direct CIL/Rust/Wasm
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
