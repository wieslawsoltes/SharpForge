# Boolean StringBuilder insertion reference

Pinned SDK 10.0.201/runtime 10.0.5 capture for `Insert(int, bool)`: 71 bounded
rows plus one mixed fluent/evaluation-order control. Cases cover both Boolean
values, null/empty/segmented receivers, insertion endpoints and Int32 bounds,
aliased reads, NUL and surrogate boundaries, identity and native capacity/chunk
observations. A few invariant/French/Turkish culture rows establish Boolean
text behavior without claiming configurable culture support in SharpForge.

UTF-16 text is recorded as numeric unit arrays; Boolean inputs remain JSON
booleans. Extreme indices only operate on tiny builders and fail before growth.
Native capacity/chunk values remain evidence, not assertions that the current
managed flattening and capacity policy matches .NET storage.

The frozen capture was generated in the root serial queue from this directory:

```sh
dotnet build -c Release --nologo
dotnet bin/Release/net10.0/StringBuilderInsertBool.dll ../string-builder-insert-bool-net10.json
```

Ordinary tests consume the unchanged 71-row snapshot and its source hash.
The fluent control records receiver/index/value evaluation order 123 and
`|!FalseaTrueb`, length 13, with the same returned builder identity. Managed
allocation limits, GC and write observers are separate host-profile controls.

Prepared validation (run by the root serial scheduler):

```sh
node scripts/limited.js node --test tests/a07-string-builder-insert-bool.test.js
node --expose-gc scripts/benchmarks/a07-string-builder-insert-bool.mjs 500 50
```

Copy the identical static benchmark to integrated repro
`170259473c74f40a6af041a0da19cf04f8a36252` for released-control comparisons.
The missing Boolean contract is skipped only in the baseline; setup, snapshot
restoration and output assertions are outside timing. No performance result is
claimed before that scheduled run.
