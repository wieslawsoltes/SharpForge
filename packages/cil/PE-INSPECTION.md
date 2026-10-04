# PE inspection

`inspectPE(bytes, options)` returns an owned, JSON-safe PE/CLI snapshot with
`format: "sharpforge.pe-inspection"` and `version: 1`. It reuses the package's PE
and metadata readers. It does not execute code, inflate PDBs, disassemble native
instructions, verify cryptographic signatures, or load referenced assemblies.

```js
import { AssemblyInspector, inspectPE } from '@sharpforge/cil';

const pe = inspectPE(bytes, { maxBytes: 16 * 1024 * 1024 });
const inspector = new AssemblyInspector(bytes);
const page = inspector.summary({
  includePE: true,
  includeMethods: true,
  methodOffset: 0,
  methodLimit: 50,
  signal,
  peOptions: { maxDebugBytes: 256 * 1024 },
});
```

The API accepts `Uint8Array`, including Node `Buffer`, or `ArrayBuffer`. It
requires a managed CLI header and readable CLI metadata; a PE containing only
native code is rejected by the existing reader. An inspection snapshot does not
establish that an image can execute on the current host.

## Snapshot fields

| Field | Contract |
| --- | --- |
| `bytes` | Input byte length |
| `imageKind` | `ILOnly`, `MixedMode`, `ReadyToRun`, or `ManagedNative` |
| `isLibrary` | COFF DLL characteristic |
| `headers.dos` | MZ signature and PE header file offset |
| `headers.coff` | Machine, section count, timestamp, symbol table pointer/count, optional-header size, characteristics |
| `headers.optional` | PE32/PE32+ format and all standard/Windows optional-header scalar fields |
| `sections` | Name, RVA, virtual/raw sizes, raw offset, header offset, characteristics, relocation and line-number fields |
| `directories` | Every advertised optional-header data directory, in physical order |
| `cli` | Header size, runtime version, decoded CorFlags, typed entry point, and all CLI directory pairs |
| `debugDirectory` | Raw debug records with exact scalar fields and owned hexadecimal payloads |
| `strongName` | Public-key and signature material, flag claims, presence/zero-state, and verification status |
| `nativeCode` | Image-level native indicators and explicit unsupported/not-disassembled status |

`imageBase`, `sizeOfStackReserve`, `sizeOfStackCommit`, `sizeOfHeapReserve`, and
`sizeOfHeapCommit` are hexadecimal strings, including in PE32 snapshots. This
preserves every bit of PE32+ UInt64 values above JavaScript's safe integer range.
All other header numbers retain their unsigned widths. `baseOfData` is `null`
for PE32+ because that format omits the field. Unknown machine codes are retained
as numbers; no architecture name is guessed.

The original `readPE()` result remains available with BigInt fields and its
legacy 16-slot `dataDirectories` array. The inspection snapshot emits only the
advertised count, retaining additional entries as `directory16`, `directory17`,
and so on when present.

### Directory addresses and ownership

A projected directory is `{ name, address, addressKind, size, fileOffset, status }`.
`addressKind` is `"file-offset"` for the certificate directory and `"rva"` for
the others. Status is `empty`, `mapped`, `address-only`, or `unmapped`.
Unmapped, unused directory addresses retain a `reason`; malformed required
metadata/native-header/debug structures still fail through the reader.

The snapshot contains no borrowed typed-array views or metadata rows. Changing
the caller's input or mutating one snapshot cannot change another snapshot.
Opaque debug and signing payloads use lowercase hexadecimal, with two characters
per input byte. Raw directory presence is not a certificate or signature verdict.

### CorFlags and image classification

`cli.flags` contains `{ value, names, unknownBits }`. Known names come from the
public `CorFlags` object: `ILOnly`, `Requires32Bit`, `ILLibrary`,
`StrongNameSigned`, `NativeEntryPoint`, `TrackDebugData`, and `Prefers32Bit`.

The existing reader recognizes a present managed-native header beginning with
`0x00525452` as ReadyToRun. Other present managed-native signatures are
`ManagedNative`. Without such a header, ILOnly selects `ILOnly`; its absence
selects `MixedMode`. A missing ILOnly bit alone does not establish ReadyToRun.

`nativeCode` contains `indicated`, an `indicators` array, `status:
"not-disassembled"`, and `disassembly: "unsupported"`. Indicators identify an
unset ILOnly bit, a native entry point, and a managed-native header. These are
image metadata facts; they do not identify native counterparts for individual
ReadyToRun methods or prove that every method has native instructions.

`cli.entryPoint` is `{ kind: "managed-token" | "native-rva", value }`. A native
RVA can never mark a numerically equal MethodDef token as the managed entry point.
A zero value means the image does not declare an entry point of that kind.

### Managed method admission

The public `methodCodeKind(implFlags)` classifies MethodImplAttributes as `CIL`,
`Native`, `OPTIL`, `Runtime`, or `UnmanagedIL`. It accepts an unsigned 16-bit
integer and ignores unrelated optimization/synchronization flags. Invalid values
throw `CilError`.

`AssemblyInspector.getMethod()` and both full and paged summaries retain
`implFlags`, `rva`, `codeKind`, and `disassembly` facts. `hasBody` means that a
nonzero RVA identifies a managed CIL implementation eligible for decoding.
`disassembly.status` is `available`, `absent`, or `not-disassembled`. A summary
whose eligible CIL body fails inspection retains `unavailable` and its error. Unsupported
implementation kinds carry an explicit reason and empty instruction/handler
arrays. `includeMethods: false` retains the same scalar code-kind and admission
facts without decoding instructions.

The shared `readMethodHeader()` and method-body reader reject nonzero Native,
OPTIL, Runtime, and unmanaged IL RVAs before interpreting bytes as a CIL header.
A zero RVA still returns `null` from `readMethodHeader()`. Usage analysis and
Portable PDB local-slot inspection reuse this classification and keep their
existing unsupported-method diagnostics.

Image kind does not decide whether an individual method has available CIL. A
ReadyToRun or mixed-mode image may contain ordinary managed method bodies, and
those remain inspectable even when ILOnly is unset. Native instructions and
ReadyToRun internal method maps are not disassembled.

### Debug records and strong names

`readPEDebugDirectory(parsedPE, options)` is the shared public raw debug reader.
It returns owned entries with `kind`, `stamp`, `major`, `minor`, `bytes`, `offset`,
`characteristics`, and `dataRva`. PointerToRawData selects bytes, including bytes
in a file overlay; AddressOfRawData is retained independently and may be zero.
The raw reader retains unknown record kinds and reserved Characteristics.

`@sharpforge/symbols.readDebugDirectory()` reuses those records, preserves its
`SymbolError` boundary for malformed debug records, and adds the existing
CodeView, checksum, and lazy embedded-PDB decoding. The PE snapshot itself leaves
payloads opaque. Native PEReader's rejection of nonzero reserved Characteristics
is recorded as an explicit reference difference for authored raw-inspection cases.

`strongName` contains a projected signature directory, `publicKeyFlag`, public
key hex, `signedFlag`, signature hex or `null`, and `signatureState` (`absent`,
`zero-filled`, `nonzero`, or `unmapped`). `verification` is always
`"not-performed"`. Neither a signed flag nor nonzero signature bytes establish a
valid strong name; public/delay-signing emission and cryptographic verification
are separate capabilities.

## Limits and cancellation

Every limit is a nonnegative safe integer. Exceeding a limit, invalid options,
malformed input, or cancellation throws `CilError`; no partial snapshot is returned.

| `inspectPE` option | Default | Hard maximum | Charged quantity |
| --- | ---: | ---: | --- |
| `maxBytes` | 64 MiB | 256 MiB | Complete input image |
| `maxDebugEntries` | 1,024 | 65,536 | Debug directory records |
| `maxDebugBytes` | 1 MiB | 64 MiB | Sum of raw debug payload bytes, including repeated ranges |
| `maxStrongNameBytes` | 8 KiB | 1 MiB | Public-key blob plus advertised signature bytes |

The raw `readPEDebugDirectory` options are `maxEntries` (default 1,024, maximum
65,536), `maxDataBytes` (default 64 MiB, maximum 256 MiB), and `signal`.
The existing PE reader additionally caps sections at 96 and directories at 64.

`signal` is checked before parsing/projection, between directory/debug records,
during hexadecimal/signature scans, and before returning output. A summary's
outer `signal` takes precedence over `peOptions.signal`; when omitted, the PE
signal is inherited for a summary that requests PE output. Parsing uses the
existing synchronous PE/metadata readers. Hosts should run large inspections in
their existing analysis worker; these APIs do not promise asynchronous preemption.

After existing PE/metadata parsing, extra work is linear in retained header
records and payload bytes, with bounded section scans for RVA mapping. Hexadecimal
output uses preallocated ASCII storage. Storage is linear in owned output; a
repeated debug range is counted and copied for every occurrence.

PE snapshots are opt-in for `summary({ includePE: true })`; `peOptions` supplies
the same limits. Ordinary summaries add inexpensive `imageKind` and method
admission facts without copying PE payloads. Public method cache identity and the
separate typed-consumer decode cache are preserved.

## Reference evidence

The fixture protocol is in
[`tests/fixtures/pe-inspection`](../../tests/fixtures/pe-inspection/README.md).
It distinguishes authored boundary images from the actual pinned .NET ReadyToRun
and Cecil mixed-mode images. Reference binaries remain external cache inputs;
retained observations contain scalar facts and hashes. Validation status and
supported host/browser runs belong to the captured evidence, not this API contract.
