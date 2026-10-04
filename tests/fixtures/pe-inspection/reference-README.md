# Native references for PE inspection

This directory's observer supports SF-A13-T16 (#706). It reads one PE/CLI image
through the pinned .NET PEReader and System.Reflection.Metadata (SRM) APIs.
It never loads an input assembly into an execution context or calls its methods.

## Input provenance and retention

[reference-images.json](reference-images.json) pins two external reference inputs.
Its byte lengths and SHA256 values are required input identities, not evidence
that a native capture has run. Capture results and tool versions are recorded
separately by the owning qualification workflow.

| ID | Reference | Pinned source | Bytes |
|---|---|---|---:|
| r2r | System.ComponentModel.Primitives.dll | .NET SDK 10.0.201, runtime 10.0.5, linux-x64 | 71,432 |
| mixed | MixedNativeCLI.exe | jbevain/cecil commit 882ca5eedda1e62eb41bd5869aeb15d8f1538e51 | 34,816 |

The runtime image is found below the installed SDK root at
`shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll`.
The manifest also records the versioned SDK archive URL, its official SHA512,
and the [Microsoft release metadata][release-metadata] source. Verify the archive
before extraction and the member's own size/SHA256 before observation.

The mixed-mode image is the exact Git blob named by the manifest, fetched through
its immutable commit URL into an external cache. Its [upstream test][cecil-test],
`ReadPdbMixedNativeCLIModule`, attributes the fixture to Microsoft's
[managed/unmanaged preprocessor example][managed-unmanaged]. This provenance is
recorded alongside the [Cecil license][cecil-license]; it is not a new conclusion
about redistribution rights for the compiled example.

Both upstream binaries remain outside the repository under
[the oracle license policy](../../../planning/qualification/oracle-licenses.md)
and its [machine-readable rules](../../../planning/qualification/oracle-licenses.json).
Do not commit a binary, an encoded copy, raw debug payloads, signing bytes, or IL
bytes from either input. Retain source identities, scalar metadata facts, names,
tokens, sizes, and SHA256 digests from the observer. Product-side raw hexadecimal
payloads are hashed transiently when compared with these observations.

For the SDK distribution, retain and consult its bundled `LICENSE.txt` and
`ThirdPartyNotices.txt`. The corresponding [SDK license][sdk-license],
[SDK notices][sdk-notices], and [runtime notices][runtime-notices] provide source
context; the files delivered with the downloaded archive are authoritative.
These references do not expand the repository's cache-only retention policy.

## Observer contract

`Program.cs` targets `net10.0` and accepts exactly one image path. A successful
invocation writes one JSON object to stdout. Invalid arguments return exit code
2; image, range, or I/O failures return exit code 1 with an error on stderr.
A malformed eligible method body is retained as that method's `bodyError`;
it is never silently converted into a successful body observation.

The owning capture runner builds the observer using SDK 10.0.201 and invokes it
using runtime 10.0.5. The observer prints its actual runtime, operating system,
architecture, and SRM assembly version. Build and capture execution are separate
qualification steps, not operations performed by this manifest.

The JSON has `schemaVersion: 1` and these records:

| Field | Native facts |
|---|---|
| `observer` | API name, runtime, OS, process architecture, SRM assembly version |
| `image` | File name, byte length, whole-image SHA256 |
| `imageKind` | ILOnly, MixedMode, ReadyToRun, or ManagedNative |
| `headers` | DOS signature/PE offset, COFF fields, complete optional-header scalars |
| `sections` | Native section names, extents, characteristics, relocation and line-number fields |
| `directories` | Declared names, addresses, address kinds, and sizes |
| `cli` | Header size, runtime version, raw CorFlags, entry-point kind/value, all seven CLI directory pairs |
| `managedNativeSignature` | Actual first UInt32 of the managed-native header, or null |
| `debugDirectory` | Native debug header facts plus payload size and SHA256 |
| `strongName` | Public-key/signed flags, payload sizes, zero/nonzero state, SHA256 digests |
| `methods` | Every physical MethodDef token, name, implementation flags, RVA, and guarded CIL-body facts |

All UInt32 values remain nonnegative JSON numbers. The five UInt64 optional-header
fields use lossless lowercase `0x` strings. A PE32+ `baseOfData` is null.
Certificate directory addresses are file offsets. Debug payload hashes use
`PointerToRawData`, including when the payload resides in an unmapped overlay.

PEReader supplies ordinary COFF, optional-header, section, CLI, and debug fields.
The observer reads only the few missing raw scalar fields independently:
DOS signature/PE offset, optional-header Win32VersionValue and LoaderFlags,
directory 15 and any later declared directories, CLI header size, and debug Characteristics.
It contains no SharpForge parser and imports no product-produced observations.

### Managed method bodies

A method is eligible only when its RVA is nonzero and both
`MethodImplAttributes.CodeTypeMask` and `MethodImplAttributes.ManagedMask`
identify managed IL. Native, OPTIL, Runtime, and unmanaged IL methods keep their
metadata facts with `body: null`; `GetMethodBody` is never called for them.
The image-level ILOnly flag is deliberately absent from this guard, so available
managed methods in a Linux ReadyToRun image remain observable.

An eligible method has `hasCilBody: true`. A successful `body` contains
`headerSize`, `totalSize`, `codeSize`, `maxStack`, `localSignature`, `initLocals`,
`exceptionRegionCount`, and `codeSha256`. Tiny/fat header width is derived from
the actual method bytes obtained through PEReader. `totalSize` is SRM's
MethodBodyBlock.Size, including the header, IL, and exception regions.
A read failure instead produces `bodyError: { type, message }` with a null body.

The ReadyToRun classification requires the actual managed-native header signature
`0x00525452`; absence of ILOnly alone does not establish ReadyToRun. Other present
managed-native signatures are reported as ManagedNative.

### Deliberate reference boundaries

The observer preserves PEReader's own malformed-input behavior. In particular,
the pinned PEReader rejects nonzero reserved debug Characteristics. SharpForge's
raw inspection view may retain that scalar; an authored case covering this
difference must identify the native rejection instead of claiming equal acceptance.

A missing public key hashes as an empty byte sequence. An absent signature has
`signatureSha256: null` and `signatureState: "absent"`; present signatures are
classified as zero-filled or nonzero and hashed. `verification` is always
`"not-performed"`: no cryptographic strong-name validation is claimed.

Input size and aggregate debug payload bytes are capped at 256 MiB. Method count
is capped at 262,144 and debug entry count at 65,536. The observer remains a
bounded native reference utility; these limits do not redefine product limits.

The Windows mixed-mode fixture is inspected as data. Its presence is no evidence
of Linux execution support, native-code disassembly, successful input execution,
or browser compatibility. Record actual qualification results separately.

## Retained capture

The [2026-10-04 capture](native.json) completed at integrated revision
`bf0d9470e4dc50cfdcafb0a6532cea0892b753d6` with both pinned input hashes and the
SDK/compiler/reference pins verified. All eight native/product fact groups
matched for both inputs. The runtime image retained 205 readable CIL bodies out
of 224 MethodDefs with ILOnly unset; the mixed-mode image retained 77 readable
CIL bodies and reported 11 Native implementations out of 90 MethodDefs. Neither
image had an eligible CIL body-read failure. These are observations of the actual
images, separate from the authored flag/header boundary fixtures.

The [qualification summary](qualification/summary.json) retains exact commands,
environment, source and artifact hashes, and the 130/130 focused Node result,
including strict source-provenance checks. Input execution, native disassembly,
browser replay, and performance remain outside that captured result. No upstream
binary or encoded payload was added to the repository.

[release-metadata]: https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
[sdk-license]: https://github.com/dotnet/sdk/blob/v10.0.201/LICENSE.TXT
[sdk-notices]: https://github.com/dotnet/sdk/blob/v10.0.201/THIRD-PARTY-NOTICES.TXT
[runtime-notices]: https://github.com/dotnet/runtime/blob/v10.0.5/THIRD-PARTY-NOTICES.TXT
[cecil-license]: https://github.com/jbevain/cecil/blob/882ca5eedda1e62eb41bd5869aeb15d8f1538e51/LICENSE.txt
[cecil-test]: https://github.com/jbevain/cecil/blob/882ca5eedda1e62eb41bd5869aeb15d8f1538e51/symbols/pdb/Test/Mono.Cecil.Tests/PdbTests.cs
[managed-unmanaged]: https://learn.microsoft.com/en-us/cpp/preprocessor/managed-unmanaged?view=msvc-170#example
