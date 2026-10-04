# Managed memory reference fixture

`Program.cs` has two distinct capture paths. The retained `ci-e093-sdk10/`
recording is the actual SDK 10.0.201 assembly and successful native/CIL result from
[CI run 37219653301](https://github.com/wieslawsoltes/SharpForge/actions/runs/37219653301),
at revision `e09324d3e83d742d47eb39b8f0482c38dc0f8756`, on Linux x64. Its
`qualification.json`, DLL and runtime configuration are unmodified artifact bytes;
`provenance.json` records their hashes, original artifact ID/digest, and the exact
source hash. The report lists installed runtimes but does **not** identify the
runtime patch loaded by the guest process. It does not contain compiler or
reference-assembly file hashes.

The separate `capture.mjs` generator uses the repository-pinned Roslyn compiler
and CoreCLR runtime. Its `native.json` format records compiler/reference hashes,
source and assembly hashes, PE bytes, native output, and the CIL comparison. That
pinned capture has not been generated or committed. The retained CI evidence is
not presented as output from this generator.

The fixture covers integer array initializers, both overlapping copy directions,
rectangular indexing and dimensions, nonzero lower bounds, stack-backed spans,
array pins, byte-array BitConverter calls, Clone and Clear. Source and reloaded
source coverage uses the separate source lowering tests; this external Roslyn PE
is qualified by the direct CIL engine.

Replay the retained CI assembly without a local .NET installation:

```sh
node scripts/limited.js node --test tests/a05-memory-native-replay.test.js
```

The ordinary A05 test imports the explicit `replay.mjs` fixture. Replay checks the
current source against the recorded hash, verifies all retained file hashes,
requires the original native execution and CIL comparison to have succeeded, and
runs the same DLL through both runtime option sets. It independently verifies the
one FieldRVA row and one `RuntimeHelpers.InitializeArray` call in the actual DLL;
these metadata counts were inspected from the retained bytes during archival.

At the exclusive native validation slot, generate a new pinned capture with:

```sh
node scripts/limited.js node tests/fixtures/a05-memory/capture.mjs tests/fixtures/a05-memory/native.json
node scripts/limited.js node --test tests/fixtures/a05-memory/replay.mjs
```

When `native.json` exists, it takes precedence and must pass its own provenance
and result checks. Only an absent file selects the retained CI recording. A
truncated, corrupt or incomplete generated capture fails; it never falls back.

The generator resolves its toolchain through `scripts/conformance/oracle/toolchain.js`; set
`SHARPFORGE_ORACLE_DOTNET` when the pinned SDK is not on PATH. No toolchain is
downloaded or installed by the capture. The old direct replay failed with ENOENT
because it required the never-generated `native.json`; this was a missing command
input, not a native or managed execution failure. The successful e093 memory case
predates this replay repair. Fresh local replay validation is recorded separately.

`expected.txt` is the authored 24-line trace for the SDK 8/10 native CI fixture
runner. It is an expected result, not a recorded native execution. The source
requires unsafe compilation; the pinned capture uses C# 12, and the operations
used are available on both target SDKs. Expected text is never substituted for a
captured native result. The original CI report retains its actual native stdout.
