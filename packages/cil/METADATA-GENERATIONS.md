# CLI metadata generations

`MetadataGenerations` reads an owned CLI metadata baseline and successive minimal
metadata deltas through the public `@sharpforge/cil` package. It exposes raw table
records, heap values, aggregate row counts, physical provenance, and both directions
of generation-local entity mapping. It does not execute assembly code.

```js
import { MetadataGenerations } from '@sharpforge/cil';

const metadata = new MetadataGenerations(baselineAssembly, { format: 'pe' });
metadata.append(firstMetadataDelta, { generation: 1 });
metadata.append(secondMetadataDelta, { generation: 2 });

const originalDefinition = metadata.getGenerationHandle({
  kind: 'entity', value: 0x06000002,
});
const currentRecord = metadata.row(0x06000002);
const originalRecord = metadata.row(0x06000002, { generation: 0 });
const signature = metadata.heapEntry('#Blob', currentRecord.values[4]);
const methods = metadata.rows('MethodDef', { offset: 0, limit: 100 });
metadata.dispose();
```

## Inputs and admission

The constructor accepts a `Uint8Array` backed by an attached, unshared,
nonresizable `ArrayBuffer`, with an explicit `format`. Intrinsic typed-array
accessors snapshot the byte extent before the budget check and owned copy;
subclass property getters and species do not control allocation or copying:
`'metadata'` (default) is a metadata root; `'pe'` uses the existing PE inspection
reader. PE inspection admits CLI metadata in IL-only, ReadyToRun and mixed images
without disassembling or executing native portions. The existing PE parser is
called once, with the same configured input-byte and metadata-row bounds used by
the generation reader.

A baseline must have one Module row, at least one TypeDef, no minimal-delta marker,
and no nonempty EnC control table. The Module's generation is zero, MVID and name
are nonempty, and its previous-generation ID is nil. Full compressed and ordinary
uncompressed CLI baselines are accepted. Portable PDB generations have a separate
symbols API and are rejected here.

`append(bytes, { generation, signal })` accepts a metadata root and returns its
zero-based generation number. The caller's generation and the Module generation
must both be the immediate successor. The existing reader requires `#-` and an
empty `#JTD` marker. MVID and decoded module name must match the baseline, the new
generation ID must be nonzero and unused, and the previous ID must equal the
preceding Module generation ID. A native first delta may therefore have a nil
previous ID. These checks establish encoded metadata linkage; they do not pair a
PDB or an IL delta with the metadata.

The public `identity` getter returns an owned object with `name`, `mvid`,
`generationId` and `previousGenerationId`. GUID identity strings are 32 lowercase
hexadecimal digits in CLI heap byte order, matching .NET `Guid.ToByteArray()`.
`generation`, `counts`, `retainedBytes` and `retainedRecords` describe the committed
history. Counts and identity objects are independent copies.

## Entity mappings and raw records

`getGenerationHandle({ kind: 'entity', value: token }, { generation = latest })`
returns `{ kind, value, generation, localValue }`. Its generation is where that
aggregate token was first introduced, matching SRM `MetadataAggregator`. Updating
an existing token does not change this mapping. Typed nil entity handles map to
their baseline nil handle; `row()` rejects nil because it is not a record.

`getAggregateToken(localToken, sourceGeneration, options)` performs the inverse
physical-row mapping in the specified source generation. Module row one is always
mapped to aggregate token one. Native writers may omit Module from `EncMap`; an
explicit Module-one mapping is also accepted.

`row(token, options)` selects the newest update at or before `options.generation`
(default latest). `rows(table, options)` returns the same records as a page.
Table identifiers may be a numeric CLI table ID or an exact name from `TableId`.
An individual record contains:

| Field | Meaning |
| --- | --- |
| `token` | Canonical aggregate token |
| `table`, `name` | Table ID and registry name |
| `generation` | Generation supplying this raw record |
| `localToken` | Physical token in that generation |
| `sourceOffset` | Byte offset in that generation's original input, including the PE envelope when present |
| `metadataOffset` | Byte offset relative to that generation's metadata root |
| `byteLength` | Physical row width in that generation |
| `values` | Independent scalar array in `tableDefinitions[table].columns` order |

Page results include `table`, `name`, requested `generation`, `offset`, `limit`,
`total`, `nextOffset` and `rows`. Offsets are zero-based; the default limit is 100
and the hard limit is 1,000. A zero limit returns an empty page and null continuation.
An offset equal to the total returns the empty final page. Invalid/future tokens
and invalid generation/page arguments throw instead of returning a partial row.

`tables({ generation, includeEmpty = true })` returns owned aggregate counts and
column/kind arrays. It excludes the two EnC control tables. `controlRows(table,
{ generation, offset, limit })` reads physical EncLog or EncMap records instead;
their row `token` is null and their `localToken` remains generation-local.

The map must contain strictly increasing, nonnil ordinary CLI tokens, with one
token for each corresponding physical delta row. New aggregate rows must be
contiguous. Updates precede inserts within a table. Unknown tables, duplicate or
missing mappings, and aggregate references outside admitted counts are rejected.
Scalar table and coded indices are checked using the shared registry. Blob
references are range checked through the existing compressed-integer reader.

**These are raw delta records.** A MethodDef's delta RVA addresses its separate IL
delta, and its ParamList may be zero. EncLog operation codes are retained without
being executed. The view does not reconstruct member-list ownership, merge or
rewrite signature payloads, create a standalone PE metadata image, validate every
semantic ECMA constraint, or implement CLR `ApplyUpdate`. It provides no `.list()`
adapter for ordinary full-metadata consumers.

## Heap handles and values

`getGenerationHandle` also accepts `kind: 'string'`, `'blob'`, `'guid'`, or
`'userString'`; `value` is a raw heap index/offset, not an `ldstr` token. Strings,
blobs and user strings have zero-based byte offsets. GUID indices are one-based.
Virtual/WinRT-projected handles and Portable PDB handle kinds are unsupported.

`heapEntry(name, index, { generation })` accepts `#Strings`, `#Blob`, `#GUID` or
`#US` and returns `{ heap, index, generation, localIndex, isNil, sourceOffset,
byteLength, payloadByteLength, value }`. Strings use the existing UTF-8 codec,
blobs and GUIDs are independent `Uint8Array` values, and user strings preserve
the existing UTF-16 code-unit semantics. Queries do not populate a persistent
decoded-string cache; arbitrary suffix lookups cannot retain quadratic string data.

The logical string extent removes trailing alignment zeros and retains one final
terminator, as SRM does. Blob and user-string extents retain physical heap sizes.
Empty generations are skipped by heap introduction mapping. GUID aggregate
extents sum physical GUID counts, but the local GUID index is not rebased.
Historical slots can be zero-filled. A mapping can consequently identify a GUID
slot that is physically unreadable; mapping succeeds and `heapEntry` then rejects
the dereference. Mapping parity is distinct from value-read success.

Nil value lookup is explicit: index zero returns an empty string, empty blob,
zero GUID, or null user string, with null source generation/offset. This value
convention is separate from SRM's boundary-based nil-handle mapping. A nonzero
user-string handle that addresses a nil/padding record is rejected, retaining the
existing CIL user-string codec's stricter admission than SRM's permissive empty
string fallback. Ordinary nonempty user-string records are decoded normally.

`heaps({ generation })` returns owned per-generation physical/logical extents and
aggregate starts/ends. Its units are `guid-index` for GUIDs and `byte-offset` for
the other heaps. It does not return borrowed heap buffers.

## Ownership, bounds and cancellation

Input byte extents are checked before allocating the owned byte copy. Each input
is copied into private storage and parsed once. Every returned collection and
binary heap value is independently owned.
Appending or disposing the reader does not change previously returned facts.
Admission completes before commit. Failed/canceled appends preserve prior state;
reentrant appends are rejected and disposal during a signal callback cannot revive
the history. `dispose()` is idempotent; subsequent reads and appends fail.

| Constructor option | Default | Hard cap |
| --- | --- | --- |
| `maxGenerations`, including baseline | 64 | 1,024 |
| `maxInputBytes`, each original input including a baseline PE envelope | 64 MiB | 128 MiB |
| `maxRetainedBytes`, sum of owned original inputs | 128 MiB | 1 GiB |
| `maxRetainedRecords`, sum of physical rows including EncMap/EncLog | 500,000 | 1,000,000 |

All constructor bounds are positive safe integers. Retained byte accounting
covers input buffers; decoded row arrays, revision indices, and JavaScript object
overhead consume additional bounded memory. The shared physical reader receives
the remaining row allowance before allocating any row arrays.

Each query accepts `maxPageBytes` (default 1 MiB, cap 16 MiB), `maxEntryBytes`
(default 64 KiB, cap 1 MiB), and `signal`. Zero query bounds are permitted. Page
accounting charges eight bytes per returned raw scalar, fixed/schema-text charges
for summaries, and encoded extents for heap reads; these are deterministic work
bounds, not measurements of engine heap allocation. A Module name is bounded to
64 KiB during identity admission. A GUID nil value charges its 16 output bytes.

Signals follow the shared CIL convention: omitted/null or an object exposing a
boolean `aborted` property. Cancellation is checked before copying, between copy
chunks, at parser stream/row boundaries, through mapping/reference scans, before
publishing a generation, and during bounded output/heap scans. Commit does not
invoke caller callbacks. All operations are synchronous; large histories belong
in a worker when the caller must keep a browser UI responsive.

Construction/append is O(input bytes + physical rows × log generations), with
schema width bounded by the registry. No dense baseline is rebuilt on append.
Entity introduction is O(log generations), current-row lookup is O(log revisions
+ returned columns), and heap lookup is O(log generations + returned payload).
Memory is O(retained input bytes + retained physical rows + generation summaries).

`metadataGenerationDiagnosticCatalog` documents the `MD_GEN_*` error codes for
input, format, identity, mappings, references, tokens, heaps, control tables,
budgets, cancellation, and disposal. Shared reader failures remain as `cause`
when they are classified into the generation API's diagnostic categories.

## Qualification and performance status

This source preparation has not been executed. The focused API, boundary and
shared-reader tests are authored. The native observer, second Roslyn mixed
insert/update corpus generator, strict provenance verifier and Node/browser replay
are prepared in `tests/fixtures/metadata-generations`; its README records the
scheduled commands and retention layout. No native, Node, browser, Rust/Wasm, source
VM or direct-CIL runtime pass is claimed. Runtime update execution is outside this
JavaScript metadata API. The existing Portable PDB generation inputs are retained
unchanged and are not themselves proof that the new API passed.

Before publication, compare ordinary default `readMetadata` and `readPE` against
the exact pre-seam main using unchanged common inputs. Guard all existing fields,
rows, heaps and ownership outside timing. The shared parser gained an optional
budget branch, so default-path cost must be measured explicitly. Use one controlled
cohort with 20 warm batches and 100 chronological measured batches, true median
and nearest-rank p95/p99, source/tool/fixture hashes, environment, and clearly
labeled heap observations. Report new history construction, two appends, and
entity/heap lookup costs separately; there is no baseline-equivalent merged API.
Retain all results and any regressions. Performance acceptance requires its own
review and is not inferred from a passing correctness gate.

Pinned primary sources, read without executing their tests:

- [.NET 10.0.5 MetadataAggregator](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataAggregator.cs), blob `602bf71a23306839307a6e9b656e1c63ea056600`.
- [MetadataAggregator tests](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Reflection.Metadata/tests/Metadata/Ecma335/MetadataAggregatorTests.cs), blob `6d52f318fd743907b07bc011254ccd0f3d02a932`.
- [StringHeap logical extent](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Internal/StringHeap.cs), blob `57f130a8ffd463fc245f883781b5edd4607dcc1b`.
- [MetadataReaderExtensions](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataReaderExtensions.cs), blob `62fbf3c8942bea9c1d20ce6bc54881c811fba7de`.

Work is associated with Project 6 issue #693 / SF-A03-T24. The observed task/mutex
ref searches and PR search were empty at the design audit. Legacy Project-only
reservation fields were not independently exposed by the connector. No claim,
lease reconciliation, or reservation-field mutation was performed for this work.
