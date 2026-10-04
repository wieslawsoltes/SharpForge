# Metadata table and heap inspection

`MetadataTableInspector` is an opt-in physical metadata view over the existing CLI
reader. It exposes all 45 CLI tables, the eight Portable PDB tables, and the
`#Strings`, `#Blob`, `#GUID` and `#US` heaps. It does not require method-body
decoding, CLR type loading, signature formatting or an assembly symbol index.

```js
import { MetadataTableInspector } from '@sharpforge/cil';

const view = new MetadataTableInspector(peBytes);
const tables = view.tables({ includeEmpty: false });
const page = view.rows('TypeDef', { offset: 0, limit: 20 });
const name = page.rows[0].columns.Name.value;
const method = view.row(0x06000001);
const blob = view.heapEntry('#Blob', method.columns.Signature.raw);
const strings = view.heap('#Strings', { offset: 0, limit: 20 });
view.dispose();
```

## Inputs and coordinates

The constructor accepts PE bytes, a standalone CLI metadata root or Portable PDB
root (`Uint8Array` or `ArrayBuffer`), a `readPE` result, or an `AssemblyInspector`.
Byte inputs invoke the existing PE/metadata reader once. Parsed inputs reuse their
metadata rows, heap decoders and original byte views. The source is borrowed:
keep its bytes, row arrays and metadata structures stable while using the view.
Construction is not a snapshot and retains the source until `dispose()`.

`fileOffset` is a byte offset from the start of the supplied image, even when that
image is a subarray of a larger buffer. `metadataOffset` is relative to the CLI
metadata root. Rows additionally expose `streamOffset`, relative to `#~` or `#-`.
For standalone roots, file and metadata offsets are identical. Heap entry offsets
point to the entry's length prefix or first string/GUID byte; `payloadFileOffset`
and `payloadByteLength` describe its payload without a compressed-length prefix.
String payload lengths exclude the terminating NUL. User-string payload lengths
include their terminal marker byte.

`streams()` lists all stream names, byte lengths and physical coordinates, including
unknown streams. `heaps()` filters that list to the four standard heaps. A missing
heap has no descriptor. Empty/absent tables have null physical row coordinates;
no row address is invented for them.

## Tables, pages and cells

`tables({ includeEmpty: true })` returns descriptors in table-ID order. Each has
`table`, `name`, `rowCount`, `rowSize`, `present`, `externalRowCount`, `sorted`,
physical coordinates and a named `columns` schema. `present` records the local
table-stream valid bit; external Portable PDB counts do not create local rows.
Widths come from the shared metadata sizing rules, including heap-size flags,
wide simple/coded indexes, `#-` pointer tables and minimal `#JTD` deltas.

`rows(table, options)` accepts an exact registry name or table ID. Its result has
`table`, `name`, `offset`, `limit`, `total`, `nextOffset` and `rows`. Offset is a
zero-based physical row index; offset equal to total and limit zero are valid
empty pages. `nextOffset: null` indicates no next nonempty page. `row(token)`
returns one row using a canonical unsigned 32-bit metadata token with nonzero
row ID. Missing rows, unsupported tables and malformed tokens throw `CilError`.

Every row has `token`, `table`, `tableName`, one-based `rowId`, physical
coordinates, `byteLength`, and a `columns` object keyed by the existing registry.
Every cell preserves its encoded integer as `raw`, its logical `kind`,
`physicalKind`, `width`, file/metadata coordinates and decoded `value`:

| Column kind | Decoded value |
| --- | --- |
| `u16`, `u32` | Unsigned scalar; EnC `Token` columns use token references. |
| String heap | String, with an accompanying `heap` address/extent record. |
| Blob heap | Owned `Uint8Array`, with an accompanying `heap` record. |
| GUID heap | Owned 16-byte array, `display` GUID text, and a `heap` record. |
| Simple/coded reference | Token, table/name/row identity, declared name where available, status and target file offset. |
| List start | Semantic target table, physical pointer/target table, start/end/count, status and first physical reference. |

References have `status: 'resolved'`, `'nil'`, `'external'` or `'invalid'`.
Resolved names come from the referenced row's declared name and namespace fields;
they are not CLR-bound, nested-name or constructed-signature display strings.
`external` identifies a valid Portable PDB external-table range without pretending
the target row is present in this image. Out-of-range references remain `invalid`;
reserved coded-index tags and values exceeding token width throw `CilError`.
`resolveTokens: false` returns canonical numeric reference tokens while preserving
the same raw columns, heap values and list ranges.

Standalone minimal `#JTD` deltas require generation context for aggregate handles.
Their non-nil row/heap references and list ranges report `status: 'unresolved'`
with `reason: 'delta-context-required'`, without decoding a possibly aliased local
entry. Heap `value` and semantic target coordinates are null; encoded scalars,
cell/row file offsets and raw handles remain available. `row.token` identifies the
physical delta row, not the aggregate identity mapped through EnC tables. Direct
heap paging/lookup still inspects local physical heap records. Generation mapping
and field-specific handle interpretation belong to the symbols delta API.

Lists are not expanded. In `#-` images, `physicalTable` and `first` identify the
pointer row; page that row to inspect its target. Empty lists have `first: null`,
including one-past-end sentinels. Invalid list bounds have `count: null` and
`status: 'invalid'`. These statuses describe the physical projection, not whole
assembly validity or managed execution eligibility.

## Heap handles and sequential pages

`heapEntry(name, index)` uses native heap handles: GUID indexes are one-based;
all other indexes are byte offsets. String suffix handles are supported. Nil
handles return the relevant empty value: empty string/blob, zero GUID, or null
user string. The GUID nil handle and nil handles in absent heaps have no physical
coordinate. Blob/GUID payloads are copied before returning them.

`heap(name, { offset, limit })` pages sequential physical records. Its `offset`
and `nextOffset` are always **byte** cursors, including the GUID heap; GUID byte
cursors must be 16-byte aligned. Pass a returned cursor unchanged to resume.
Results have `name`, `offset`, `limit`, `totalBytes`, `nextOffset` and `entries`.
String suffix handles need not appear in sequential enumeration. A caller-supplied
cursor is interpreted at that byte position; the view does not scan the preceding
heap to prove it came from an earlier record boundary.

User-string entries preserve UTF-16 code units, embedded NULs and the physical
`terminalMarker`; marker semantics are not revalidated here. A physical zero-length
record at a nonzero `#US` offset is shown as `isPadding: true`, with null value/token.
Direct `heapEntry` rejects that same offset as an invalid string handle. The nil
record at byte zero has `isNil: true`; normal strings have their `0x70` token and
`isPadding: false`. Truncated, unterminated, invalid UTF-8 and malformed compressed
records throw `CilError` through the existing heap and binary decoders.

## Bounds and ownership

Constructor `maxBytes` defaults to and cannot exceed 64 MiB. Existing metadata
reader limits, including its aggregate row cap, still apply. Table/heap page
`limit` defaults to 100 and cannot exceed 1,000. Page options are safe nonnegative
integers; invalid types, null options, negative/fractional values and overflow reject.

`maxPageBytes` defaults to 1 MiB and has a hard maximum of 4 MiB.
`maxEntryBytes` defaults to 64 KiB and has a hard maximum of 1 MiB. Both may be
zero. These bounds charge physical row bytes and every projected encoded heap/name
occurrence, including repeated references, before decoding/copying its payload.
Synthetic nil values have no encoded byte extent. These are logical byte/count
bounds, excluding object/array/string overhead and earlier reader caches; they are
not process-memory ceilings. An over-budget operation throws without returning a
partial page. `signal` cancels construction, metadata inventories and page work.

Construction retains the reader's eager row parse. Projection visits requested
rows and bounded referenced names only; it neither formats signatures nor reads
method bodies. Table inventory work is fixed by the 53-schema registry. Row-page
work is linear in selected columns and charged heap bytes; heap-page work is linear
in the selected encoded records. No full list or preceding-page array is built.

Every returned record/schema/array and blob/GUID value is owned by the caller.
Changing an output does not alter later queries or source bytes. `dispose()` is
idempotent and releases the borrowed context; later queries throw `CilError`.

The [focused fixtures and native gate](../../tests/fixtures/metadata-table-views/README.md)
describe coverage and pending engine/platform qualification.
