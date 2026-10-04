# Managed memory reference fixture

`Program.cs` is compiled by the repository-pinned Roslyn compiler and executed by
the pinned CoreCLR runtime. The capture stores compiler/reference hashes, source
and assembly hashes, the actual PE bytes, the native output, and the CIL-engine
comparison. The capture explicitly checks that Roslyn emitted FieldRVA metadata
and calls to `RuntimeHelpers.InitializeArray`.

The fixture covers integer array initializers, both overlapping copy directions,
rectangular indexing and dimensions, nonzero lower bounds, stack-backed spans,
array pins, byte-array BitConverter calls, Clone and Clear. Source and reloaded
source coverage uses the separate source lowering tests; this external Roslyn PE
is qualified by the direct CIL engine.

At the exclusive native validation slot, capture with:

```sh
node scripts/limited.js node tests/fixtures/a05-memory/capture.mjs tests/fixtures/a05-memory/native.json
node scripts/limited.js node --test tests/fixtures/a05-memory/replay.mjs
```

The toolchain is resolved by `scripts/conformance/oracle/toolchain.js`; set
`SHARPFORGE_ORACLE_DOTNET` when the pinned SDK is not on PATH. No toolchain is
downloaded or installed by the capture. Native capture and replay remain pending
until the generated `native.json` is committed with the actual recorded result.

The explicit replay is outside the automatic unit-test glob until a pinned native
capture exists, so an unavailable SDK cannot appear as a passing qualification.

`expected.txt` is the authored 24-line trace for the SDK 8/10 native CI fixture
runner. It is an expected result, not a recorded native execution. The source
requires unsafe compilation; the pinned capture uses C# 12, and the operations
used are available on both target SDKs. Keep the capture as the separate provenance
record for FieldRVA emission and native execution.
