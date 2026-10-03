# Metadata construction and structural validation

The metadata API uses ECMA-335 sixth edition II.22 and II.24 and the Portable PDB table
layout. It handles binary structure independently of runtime execution support.

| API | Capability | Boundary |
| --- | --- | --- |
| `TableId`, `Tables`, `tableDefinitions`, `metadataSchemas` | Names and physical columns for tables 0–44 and 48–55 | Reserved gaps 45–47 have no schema |
| `MetadataBuilder.addRow(table, values)` | Named columns for all 53 tables | Coded columns take CLI tokens; simple columns take row numbers or same-table tokens |
| `builder.definitions`, `.manifest`, `.interop` | Scoped convenience writers and exported attribute flags | Same PascalCase column names as the registry; missing/unknown columns are errors |
| `builder.string`, `.blob`, `.guid`, `.userString` | Deduplicated heaps and wide heap indexes | GUID 1 is the deterministic MVID; custom GUID indexes begin at 2 |
| `builder.finish()` | Required sorting, sorted mask, and dependent metadata handle remapping | Source insertion handles remain stable; `builder.tokenMap` exposes final sorted handles |
| `readMetadata(bytes)` | Compressed and uncompressed table streams, ExtraData and prechecked row payload sizes | Maximum one million total rows, existing bounded heap reader |
| `metadata.list(ownerToken, columnName)` | Field, method, parameter, event, property and PDB local lists | Resolves pointer tables only for `#-` streams; rejects malformed ranges |
| `validateMetadata(metadata, options)` | II.22 structural rules, heap/token ranges, duplicate keys, flags, nesting and list order | Referenced type resolution, signature legality and executable verification belong to separate APIs |

Run `node examples/metadata/table-builder.mjs` for a complete construction example.
The output is `Demo.Example+Nested` followed by an empty structural diagnostic list.

`add(table, positionalRow)` remains available for binary tooling. `finish()` rejects
column overflow instead of silently truncating it. Named heap columns also accept
existing numeric heap indexes, allowing lossless copying of row values.

`new MetadataBuilder(name, { uncompressed: true, extraData: 0x12345678 })` emits `#-`
and the optional ExtraData word. Physical pointer/EnC rows are retained in `rows`;
`AssemblyInspector` consumes resolved list tokens for every declaration owner.

Validation returns `{ code, severity, message, table?, row?, column? }` diagnostics
using `metadataDiagnosticCatalog`. `maxDiagnostics` defaults to 100; an extra `MD0099`
indicates truncation. An already aborted `AbortSignal` or cancellation observed between
row chunks raises `CilError` with `code: 'MD_CANCELED'`. Validation has no resources to
dispose, and does not mutate the input or execute code.

The table API runs in JavaScript on Node and browser engines. The standalone Rust
metadata reader is a separate implementation; these changes do not qualify that target.
Native interoperability evidence comes from System.Reflection.Metadata observations and
Roslyn-produced reader fixtures, not from running generated code.

Measure using `node --expose-gc scripts/bench/a03-metadata.js`. It records cold, median,
p95 and p99 times plus heap deltas as an allocation proxy; timing is kept outside unit
assertions. Fixture provenance and regeneration commands live in
`tests/fixtures/a03-metadata/README.md`.
