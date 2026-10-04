# Metadata table views — SF-A13-T14 / #704

Implementation and focused cases are prepared for the serialized validation slot.
No passing runtime, native or browser qualification is claimed by this description.

`fixture.js` extends the established A03 structural metadata fixture to physically
include all 45 CLI tables in a `#-` image, including the five pointer tables, EnC
log/map, and legacy processor/OS rows. It returns the same metadata as a standalone
root and a PE image. A Portable PDB fixture adds all eight PDB tables and external
method counts, with 65,535/65,536 boundaries in focused tests. These are metadata
inspection fixtures; no managed body execution or assembly validity is claimed.

Focused tests cover named schemas, full encoded row extents, pointers and empty
lists, token status/name resolution, raw token mode, paged access without body
decoding, external PDB references, prefixed input buffers, owned outputs,
disposal, malformed tokens/tags/records, nil and absent heaps, compressed-length
boundaries, string suffix handles, GUID endianness, UTF-16 code units, padding,
page/entry budgets and cancellation.

## Native SRM reference

Run `capture.mjs <explicit-output-path>` through the scheduled validation wrapper
with `SHARPFORGE_ORACLE_DOTNET` pointing to the pinned SDK. The driver reuses
`resolveToolchain`, `compileOnce` and `executeAssembly`; it writes compilation and
execution evidence before requiring success. It embeds fixture images into the
native oracle source, so the oracle cannot substitute a different image. No new
NuGet package, runtime loader or independent JavaScript decoder is introduced.

`Program.cs` uses `MetadataReaderOptions.None`, native
`GetTableRowCount`, `GetTableRowSize`, `GetTableMetadataOffset`, `GetHeapSize`,
`GetHeapMetadataOffset`, heap getters and typed SRM row getters. These APIs are
documented in Microsoft's [MetadataReaderExtensions reference](https://learn.microsoft.com/dotnet/api/system.reflection.metadata.ecma335.metadatareaderextensions?view=net-10.0).

The gate checks every physical row's complete scalar byte dump and position against
SRM's table extents, then compares independently decoded named columns for every
typed row accessor exercised by the fixtures. Pointer/layout/legacy processor
tables have no typed SRM row getter; their physical row bytes, counts and offsets
are compared, and their column names/types come from the established ECMA registry.
PDB external references are numeric in the native output and explicitly `external`
in the inspector. All four heaps have native handle/value/offset probes, including
a string suffix, GUID zero/endian order, blob data and empty/Unicode user strings.

The intended retained output is `native.json`. It records exact toolchain and host
facts, compiler/fixture/template/image hashes, compilation outcome, raw CoreCLR
stdout/stderr and parsed observations. The normal native-reference test reads that
file without compiling, running a subprocess or changing tracked files. A missing
reference is a failing gate, not a skipped qualification.

## Scheduled checks

Register these three files in A13 and run them together through `scripts/limited.js`:

- `tests/a13-14-metadata-tables.test.js`
- `tests/a13-14-metadata-heaps.test.js`
- `tests/a13-14-metadata-native.test.js`

`browser.mjs` exports the usual `run()` report for Chromium, Firefox and WebKit.
It exercises all table schemas, bounded pages, native parity, output ownership,
heap padding, limits and cancellation without a Node-only product dependency.
Record actual engine/OS/toolchain results after the serialized run. Windows/macOS
or other unavailable targets remain unverified; authoring fixtures alone is not
cross-platform evidence. Minimal `#JTD` width qualification also requires the
shared metadata sizing seam supplied by the Portable PDB delta batch.
