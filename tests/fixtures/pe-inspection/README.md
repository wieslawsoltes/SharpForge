# SF-A13-T16 PE inspection fixtures

This batch inspects PE/CLI structure and reports native portions as not
disassembled. The product API and limits are documented in
[`packages/cil/PE-INSPECTION.md`](../../../packages/cil/PE-INSPECTION.md).

## Authored boundary cases

`input.mjs` composes the existing independent `managedFixture`, PE writer, and
binary primitives. It generates bytes in memory; no binary fixture is committed.
The test corpus covers PE32 and PE32+, unsigned headers and UInt64 precision,
section scalar fields, 15/16/17 advertised directories, certificate file offsets,
unmapped directory reporting, CLI flags and entry-point kinds, debug overlays,
unknown/reserved records, signing reservations, byte/count limits, cancellation,
and owned output.

Its ReadyToRun header and mixed-mode flags are deliberately authored structural
cases. They test classification and admission, and do not establish that a native
compiler generated either image. Native, OPTIL, Runtime, and unmanaged IL methods
use nonzero RVAs, including unmapped ones, to prove that those RVAs never enter the
CIL header decoder. A separate non-ILOnly ReadyToRun marker retains an ordinary
CIL method. PDB local-slot and usage consumers share the same implementation rule.

The raw debug API retains reserved Characteristics fields. The pinned native
PEReader rejects nonzero values; this is an explicit raw-inspection difference,
not a native acceptance assertion.

## Actual native references

[`reference-images.json`](reference-images.json) pins the exact .NET runtime
ReadyToRun image and Cecil mixed-mode executable. Their source, license, hash,
cache-only policy, and independent observer schema are detailed in
[`reference-README.md`](reference-README.md).

`Program.cs` uses PEReader/SRM under SDK 10.0.201 / runtime 10.0.5. It observes
every MethodDef and reads CIL only when the metadata code type and managed bit
admit it. `comparison.mjs` compares those independent facts with the current
public SharpForge APIs and hashes actual retained CIL. It also invokes public
method inspection to confirm that available CIL is exposed and unsupported
implementations have empty disassembly. Body-format failures are retained
separately; signature/display failures do not become successful parity results.

The command requires explicit local cache paths and an explicit output path:

```sh
SHARPFORGE_ORACLE_DOTNET=/absolute/dotnet-sdk-10.0.201/dotnet \
  node scripts/limited.js node tests/fixtures/pe-inspection/capture.mjs \
  /absolute/capture/native.json \
  /absolute/dotnet-sdk-10.0.201/shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll \
  /absolute/cache/MixedNativeCLI.exe
```

The SDK archive and each image are pinned separately. The capture does not fetch
files, install tools, execute an input assembly, or write to a tracked fixture
implicitly. It verifies toolchain/image identity, compiles only the authored
observer, compares both images, and writes progress/failure information to the
requested JSON path. Only a completed comparison sets `status: "pass"`.
The output contains tool versions, compiler diagnostics, normalized native
commands, source hashes, independent facts, and comparison verdicts. It contains
no upstream executable, IL, debug, or signing payload copies.

Once reviewed, `native.json` is the retained capture artifact. The offline
`a13-16-native-reference.test.js` checks its reference identities, comparison
coverage, actual R2R/non-CIL facts, tool versions, and source freshness. This is a
check of retained native evidence; it does not rerun PEReader or load an absent
cache image. Rerun the explicit capture to compare current binaries after a
relevant source change. Tests never require network or modify tracked fixtures.

## Focused Node gate

Run after a successful native capture has been reviewed and retained:

```sh
node scripts/limited.js node --test \
  tests/a13-16-pe-headers.test.js \
  tests/a13-16-method-code.test.js \
  tests/a13-16-debug-directory.test.js \
  tests/a13-16-native-reference.test.js \
  tests/a13-04-unnamed-slots.test.js \
  tests/a13-11-usage-relations.test.js \
  tests/a13-11-inspector-navigation.test.js \
  tests/a13-01-debug-directory.test.js \
  tests/a13-01-embedded-compression.test.js \
  tests/managed-il.test.js
```

## Browser replay and platform boundary

`browser.mjs` exports `run()`, which exercises authored headers, ownership,
classification, method admission, the symbols raw-reader seam, and limits and
cancellation. The same host used by other fixture replays supplies package import
maps. It returns its exact checks/groups and marks native reference replay as
`not-run` when actual image bytes were not provided.

For actual reference replay, the host may pass explicit cache bytes and the
corresponding captured native observations:

```js
run({ references: [
  { id: 'r2r', bytes: r2rBytes, native: capture.observations[0].native },
  { id: 'mixed', bytes: mixedBytes, native: capture.observations[1].native },
] });
```

The shared comparison verifies each image hash again. Supplying the reference
JSON alone cannot produce a browser native-comparison pass.

The mixed-mode reference is a Windows C++/CLI executable. It is observed as data
on Linux; Linux execution is unsupported by this fixture. Native instructions,
ReadyToRun method maps, cryptographic signing verification, and input-assembly
execution are outside the inspector. Source VM and managed execution backends
do not execute these inspection fixtures.

## Validation status

Implementation and fixture protocol are prepared for root-owned serial
qualification. No native capture, Node test run, browser replay, build, or
performance measurement is claimed by these authored files. Replace this status
with actual recorded results when qualification completes; retain failures and
unsupported targets explicitly.
