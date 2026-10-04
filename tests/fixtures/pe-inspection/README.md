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

The three construction changes at
`d72a9fe1684ba28064f83f4307721a1d00b13137` passed one fresh two-image native
capture at `b29dd68de7d0d20eea64ef9b3ce29c80ebefabac`. The current
[native.json](native.json) has SHA-256
`8cf9f13a29b3d74f4d6d395a521f130de5abf6d7482d16a8763109a3d0cd80f1`.
The [new command](qualification/optimized/native-command.json),
[log](qualification/optimized/native-capture.log), and
[complete original/fresh comparison](qualification/optimized/native-comparison.json)
retain exact source and execution provenance. All eight comparison groups passed
for both images; all independent native facts and parity results equal the
original exactly. Only the three source hashes and two observer elapsed-time
observations differ in the complete captures.

The unchanged ten-file focused gate then passed once at
`135c4c0b151acc92b28b724b410e9db54066b29e`: **130/130 tests**, zero failures,
cancellations, and skips, in 11.749540637 seconds. The
[command receipt](qualification/optimized/focused-command.json),
[complete output](qualification/optimized/focused-node.tap), and
[output review](qualification/optimized/focused-review.json) remain separate.
The post-run receipt parser expected TAP summary markers and failed on Node's
default reporter; read-only extraction of the existing output confirmed the
counts. The test command exited 0 and was not rerun. The
[optimized qualification summary](qualification/optimized/summary.json) records
that bookkeeping error and the pending benchmark/browser/build qualification.

The original qualification below remains historical evidence. The strict
live-source identity assertions are unchanged. All original native and Node
artifacts are retained byte-for-byte in
[qualification/performance-first](qualification/performance-first/independent-review.md).

Native and focused Node qualification completed on **2026-10-04** at integrated
revision `bf0d9470e4dc50cfdcafb0a6532cea0892b753d6`. The integration preserved the
reviewed PE/method/symbols source seams and the incoming literal cache correction.
No product source changes were needed during qualification.

The first explicit capture passed under SDK **10.0.201**, CoreCLR **10.0.5**,
Node **v24.19.0**, Linux x64. The compiler hash and all 167 reference assemblies
matched the repository's pinned toolchain. Both supplied images matched their
manifest byte counts and SHA-256 before observation. All eight comparison groups
passed for each image: image kind, headers, sections, directories, CLI fields,
debug directory, strong-name facts, and every MethodDef's comparable body facts.
SRM's additional `totalSize` observation remains in the native record; it has no
matching product field and is excluded from the parity comparison.

| Actual image | MethodDefs | Available CIL bodies | CIL body-read failures | Non-CIL methods |
| --- | ---: | ---: | ---: | ---: |
| Runtime ReadyToRun image | 224 | 205 | 0 | 0 |
| Cecil mixed-mode image | 90 | 77 | 0 | 11 Native |

The ReadyToRun image's machine is `0xfd1d`, CorFlags are `0x0c` (ILOnly unset),
and the managed-native header has the actual `0x00525452` signature. Its readable
CIL was retained without inferring native counterparts for individual methods.
The mixed-mode image has machine `0x8664`, CorFlags `0`, and no managed-native
header; all 11 Native methods remained undisassembled. The remaining 19 and 2
MethodDefs, respectively, have no eligible CIL body.

The exact ten-file Node gate above passed **130/130 tests**, with **0 failures,
0 cancellations, and 0 skips**, in 12.196 seconds. It includes the strict native
provenance tests, which verify reference identities, source freshness, complete
comparison coverage, and the actual non-ILOnly/Native-method observations.
This was one capture and one focused test run; no fixes or reruns were required.

Retained evidence:

- [Original native.json](qualification/performance-first/original-native.json): independent observations and original public-API comparisons;
  SHA-256 `bdb094d3714b593bf70a1bac84bb456def0052c0019dc0ecedf1d4b8b2e298e4`.
- [qualification/summary.json](qualification/summary.json): source revision, toolchain,
  source/artifact hashes, results, and explicit remaining qualification.
- [Native command/environment/status](qualification/native-command.json) and
  [capture log](qualification/native-capture.log).
- [Focused command/environment/status](qualification/focused-command.json) and
  [complete Node output](qualification/focused-node.tap).

The supplied binaries remain external cache inputs. Retained native observations
contain scalar metadata facts, names, sizes, and hashes; they contain no image,
IL, raw debug, or signing payload copies. Neither input assembly was executed.
Windows C++/CLI execution on Linux, native instruction disassembly, ReadyToRun
method maps, and cryptographic signature verification are not qualified by this
inspection evidence.

The [first benchmark cohort and independent review](qualification/performance-first/independent-review.md)
retain all 960 samples and the complete original native/Node evidence. All three
ordinary median regressions exceed 5%; passing output guards does not accept
those regressions. See the [performance protocol](../../../packages/cil/PE-PERFORMANCE.md).
Browser replay and a build remain pending; the prepared browser harness has not
been qualified.
