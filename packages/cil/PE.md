# PE image layout and platform targets

The PE writer follows [Microsoft's PE/COFF format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)
and the ECMA-335 sixth edition CLI header layout.
Platform options are accepted by `compileToIL`, `emitAssembly`, `emitAssemblyDetailed`
and the low-level `writePE` wrapper. The section writer is `writePortableExecutable`.

| Option/API | Behavior |
| --- | --- |
| `platform: 'anycpu'` (default) | PE32/I386 with ILONLY |
| `platform: 'x86'` | PE32/I386 with ILONLY and 32BITREQUIRED |
| `platform: 'x64'` | PE32+/AMD64 with ILONLY |
| `platform: 'arm64'` | PE32+/ARM64 with ILONLY |
| `prefer32Bit: true` | AnyCPU executables only; sets both preferred and required bits according to the CLI convention |
| `outputKind: 'library'` | IMAGE_FILE_DLL and a zero managed entry point |
| Console/executable output | IMAGE_FILE_DLL is clear |
| `subsystem: 'windows'` | Windows GUI subsystem; the default is Windows CUI |
| `framework: 'mscorlib4'` | Emits mscoree.dll import, CorExeMain/CorDllMain thunk and relocation section; ARM64 is explicitly unsupported |
| `writePE(..., options)` | Optional extra sections, file/section alignment, image base and directories |
| `writePortableExecutable(sections, options)` | Ordered `.text`, `.rsrc`, `.reloc` sections with computed RVA/raw offsets |
| `readPE(bytes, { inspection: true })` | All 16 data directories, optional header fields, CLI flags/directories, ILOnly/MixedMode/ReadyToRun classification |

For example:

```js
const result = compileToIL('Console.WriteLine(42);', { platform: 'arm64', subsystem: 'console' });
const pe = readPE(result.assembly);
console.log(pe.machine, pe.magic, pe.isLibrary);
```

`readPE` exposes `dataDirectories` in numeric order and `directories` keyed by
`PEDirectoryNames`. CLI directory objects contain `rva` and `size`: `resources`,
`strongNameSignature`, `codeManagerTable`, `vtableFixups`, `exportAddressTableJumps`,
and `managedNativeHeader`. ReadyToRun classification requires its RTR signature;
other managed-native headers are reported as `ManagedNative`. Inspection performs
no execution. Execution profiles continue to reject mixed-mode/native entry points.

Section/header arithmetic and ranges are checked before reads or output allocation.
These operations are synchronous and bounded by the binary writer/reader limits;
there are no persistent resources to dispose. Image bases are represented as BigInt.
The high-level emitter uses its fixed `.text` RVA so previously assigned method RVAs
remain valid. Low-level callers can control the first section RVA and alignments.

Canonical source loading replays recorded platform options and compares every
executable byte, including import thunks and relocations. Append-only debug payloads
are supported on the final section; changing a thunk or import still rejects the image.

T03 scope remains open for managed/Win32 resource construction, cryptographic content
identifiers/checksum, public signing, input assembly identities and netmodules. This
batch establishes their layout/directory foundations without claiming those features.
