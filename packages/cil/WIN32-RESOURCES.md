# Win32 resource output

`compileToIL`, `emitAssembly` and low-level `writePE` accept `win32Resources`:

```js
{
  version: { fileVersion: '1.2.3.4', productVersion: '5.6.7.8', productName: 'Example' },
  manifest: '<?xml version="1.0"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"/>',
  icon: icoBytes, // Uint8Array containing an ICO file
  language: 0x409 // defaults to US English
}
```

The version writer emits VS_VERSIONINFO, VS_FIXEDFILEINFO, a Unicode StringFileInfo table and a matching Translation
entry. Versions have exactly four UInt16 components. Supported string fields are companyName, fileDescription,
productName, originalFilename, internalName, legalCopyright and comments. ProductVersion defaults to FileVersion.
Version information has resource type 16/id 1; a manifest has type 24/id 1 for executables or id 2 for libraries. Manifests
are embedded as UTF-8 data without XML resolution or external I/O. ICO images become type 3 resources and one type 14
icon group; image ranges and counts are checked, while image content remains opaque.

The `.rsrc` section uses sorted type/name/language directories, named entries before numeric IDs, zero timestamps,
aligned data entries and checked final RVAs. Empty resources are supported. The combined directory has a conservative
16 MiB limit and at most 65,535 entries; names have at most 1,024 UTF-16 code units. Malformed inputs throw CilError,
which compileToIL converts to an emission diagnostic. No resource data is executed during inspection.

For custom types, pass `{ entries: [{ type: 'CUSTOM', name: 1, language: 0, bytes, codePage: 0 }] }` instead of the
convenience options. Types and names can be strings or UInt16 IDs; language is UInt16. Raw entries cannot be combined
with convenience options. Duplicate keys are rejected; input order does not affect output.

`writeWin32Resources(options, { sectionRva, library: false })` returns a complete `.rsrc` byte array for a known final
RVA. `readWin32Resources(readPE(bytes), { includeBytes: false })` returns type/name/language/codePage/size records;
`includeBytes` copies payload bytes. The reader rejects cyclic/shared directory nodes, excessive depth and ranges
outside the declared resource directory. This API is synchronous and bounded; it owns no persistent resources.

Compiler assembly-attribute projection is not implemented by this slice. It does not automatically map
AssemblyFileVersionAttribute or other source attributes into these options; that mapping follows the attribute
emission work. The explicit version options and resource tree are usable independently. This limitation leaves
T03.5's source-attribute acceptance open. Host-specific Windows loader/display qualification remains separate.

## Projection from explicit assembly metadata

`win32VersionFromAssembly(readPE(assemblyBytes))` returns a `win32Resources.version`
options object by reading real Assembly CustomAttribute rows. It never instantiates
attribute classes or executes constructors. Feed the result to the existing resource
writer/emitter; callers can add or override explicit resource fields afterward.

| Assembly attribute | Version option |
| --- | --- |
| AssemblyFileVersion | fileVersion |
| AssemblyTitle | fileDescription |
| AssemblyCompany | companyName |
| AssemblyProduct | productName |
| AssemblyDescription | comments |
| AssemblyCopyright | legalCopyright |

Missing AssemblyFileVersion falls back to the Assembly row's four-part version. File
version attributes with two through four UInt16 decimal components are normalized to
four parts; wildcards and invalid values fail explicitly. Missing descriptive attributes
leave their fields absent. ProductVersion follows the existing writer's FileVersion
default. AssemblyInformationalVersion, trademarks, original/internal file names and other
attributes are outside this initial projection; callers may supply explicit writer options.
Source attribute binding/emission remains separate work, so this helper accepts existing
metadata rather than parsing source.

Duplicate recognized assembly attributes, malformed constructors/blobs, null/NUL-containing
strings and invalid versions throw CilError. The helper accepts MemberRef and MethodDef
constructors, reuses the typed custom-attribute decoder, and ignores attributes on other
parents. Bounds are 4096 CustomAttribute rows, 65536 TypeDefs/MethodDefs for local constructor
ownership, 256 signature bytes, 32 KiB attribute blobs, and 8192 UTF-16 string code units;
name heap scans are bounded before decoding. Returned values are strings and retain no input
byte views. Roslyn 5.3.0 metadata and LLVM 22.1.8 independently captured resource bytes confirm
the projected FileVersion and descriptive strings. All 15 projection/Win32 tests pass.
Evidence is under `tests/fixtures/a03-version-attributes`; Windows Explorer and broader
browser/platform qualification remain open.
