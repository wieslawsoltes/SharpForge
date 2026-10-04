# Decompiler metadata inventory — SF-A13-T10.5 / #2570

`decompileAssembly(input, options)` now returns an owned `inventory` alongside
the existing method results and source text. It enumerates local **physical**
metadata rows, including rows missing from the inspector's semantic collections.
Reading or decompiling an image does not execute its managed code.

```js
const result = decompileAssembly(image, {
  inventory: { maxRows: 100_000, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 65536 },
  signal,
});
const methods = result.inventory.tables.find(table => table.table === 6);
console.log(methods.rowCount, methods.summarized, methods.unsupported);
```

The schema is version 1. `tables` follows the existing 53-schema table registry,
including absent and present-but-empty tables. Each table records `table`,
`name`, `present`, physical `rowCount`, separate `externalRowCount`, named
`columns`, owned `rows`, and rendered/summarized/unsupported counts. Columns
retain their logical kind, physical kind, byte width and offset within a row.

Every physical row appears once, with `table`, `tableName`, one-based `rowId`,
unsigned `token`, physical coordinates, `byteLength`, an owned `raw` scalar
array in column order, `status`, `reason`, and any diagnostic. Physical offsets
use the existing table-view contract: file-relative, metadata-root-relative and
table-stream-relative byte coordinates. Raw coded indexes, list starts and heap
handles remain encoded scalars; they are not resolved targets or declarations.

| Status | Meaning |
| --- | --- |
| `rendered` | Reserved for complete representation of a row's supported semantics. The current pipeline does not assign it. |
| `summarized` | The result includes a declared-name/encoded-scalar summary or a link to partial method output. |
| `unsupported` | The decompiler has no semantic summary/output for this row, its summary is malformed, or generation context is missing. Raw facts remain available. |

Named and structural tables expose their own string columns under
`summary.strings`, decoded through the existing bounded table-heap reader.
The assembly result's `name` comes from this captured Assembly/Module summary;
it is `null` when that declared name cannot be summarized. It does not trigger
a second pass through unrelated attributes, references or resources.
No signature, reference target, custom attribute, marshalling/security payload,
type instantiation or Portable PDB record is invented or semantically decoded
by this layer. Unsupported payload tables remain explicit, including constants,
custom attributes, marshaling, security, standalone/type/method signatures, EnC
tables and debug tables. The returned table schema identifies every raw field.

MethodDef rows are matched only by exact physical token to an existing method
result. An available body, IL fallback or no-body diagnostic gets `summarized`
and a `renderedOutput` link containing `resultIndex`, `language` and explicit
`extent`: `method-body`, `cil-listing` or `absence-diagnostic`. None of these
extents preserves every flag, signature detail, custom attribute and associated
row. Missing/orphan method results and `INVALID_METHOD` failures stay
`unsupported`. Existing per-method `complete` and reconstruction counts retain
their method-body meaning.

`accountedRows` equals the sum of physical table counts, and
`accountingComplete: true` means every row has a status. It does **not** mean
semantic metadata validity or complete source reconstruction. Both
`inventory.sourceComplete` and assembly-result `sourceComplete` are false.
Inventory diagnostics always state that whole-assembly C# reconstruction is
incomplete and group unsupported counts by table. A row with a malformed name
also retains its own error diagnostic. No diagnostic is dropped to improve a
coverage count.

Portable PDB external counts never create phantom rows. The shared census can
inspect standalone roots for qualification, but the public decompiler still
accepts its existing PE/AssemblyInspector inputs. Minimal `#JTD` row identities
are physical positions, not aggregate EnC identities; all such rows explicitly
require generation context, with no local-heap alias interpretation.

## Bounds, cancellation and ownership

Nested `inventory` options allow nonnegative safe integers. Defaults are 100,000
rows, 16 MiB of encoded row/name bytes and 64 KiB per name occurrence. Hard caps
are 1,000,000 rows, 64 MiB and 1 MiB respectively. Zero is useful for empty
inventories; nonempty over-budget input rejects. The existing reader's 64 MiB
input cap and metadata row cap also apply. Counts and aggregate physical row
bytes are checked before row projection or method decompilation. Name extents
are bounded before decoding; repeated names are cached but charged on every
successful occurrence. Malformed-name results are also cached. Scanned prefixes
are charged as the shared heap reader checks its progress, including failed
unterminated scans; its 128-byte polling interval can examine at most 127 further
bytes per newly visited name before reporting a malformed end. Distinct invalid
offsets therefore share the same total scan/summary budget. `summaryBytes`
includes those charged failed prefixes. Accounting excludes JS object overhead, immutable-string storage
and the existing reader's caches, and is not a process-memory ceiling.

The existing top-level `signal` is checked during census, rows, names and final
classification. Invalid options, cancellation and budget exhaustion throw;
there is no partially successful inventory. A malformed optional row summary
retains that row as unsupported. Invalid table containers, scalar widths or
count/row mismatches reject the census. Codes `CILDI0001`–`CILDI0004` identify
input/options, size, cancellation and census mismatch respectively;
`CILDI0005`–`CILDI0009` identify missing summaries, incomplete C#, missing method
results, partial method output and unsupported semantics. Existing earlier CFG
input/cancellation diagnostics remain unchanged.

All results are owned scalar records, strings and arrays. No input byte views,
metadata reader, inspector or lookup cache is retained. Later mutations of an
input or returned inventory cannot change another snapshot. No disposal API is
needed. Work is O(physical rows + columns + charged name bytes + method results),
with one token map for method-output links and bounded name caching. Metadata
enumeration does not decode method bodies; the existing decompiler stage does.

## Evidence and qualification

The focused tests cover all 45 CLI and eight PDB tables, empty and absent tables,
65,535/65,536 row identities, external counts, minimal deltas, body/IL/no-body
links, orphan and invalid methods, malformed names/rows, exact budgets,
preflight rejection, cancellation and owned results.

Native tests reuse the unchanged [table-view SRM evidence](../../tests/fixtures/metadata-table-views/README.md):
SDK 10.0.201 / CoreCLR 10.0.5, independently observed row counts, every token,
row extent/scalar byte dump and available typed string columns. Reference JSON
SHA-256 is `b9fe9c749515f4d14ab4da150b00a7f4bd33037d7bb903c40e03c67d865f05b7`;
each embedded image hash is checked before comparison. No new native result is
fabricated or required to repeat those observations. The four legacy processor/
OS tables retain SRM's actual `BadImageFormatException` rejection; SharpForge's
physical census of them does not claim native acceptance.

```sh
node scripts/limited.js node --test tests/a13-10-metadata-inventory.test.js tests/a13-10-metadata-inventory-native.test.js
```

These new tests have not yet run. The authored browser entry point is
`tests/fixtures/decompiler-inventory/browser.mjs`; serve the repository package
import map and call its `run()` in each real Chromium, Firefox and WebKit engine.
Browser and other OS results remain pending. This is a JavaScript metadata/
decompiler feature; CLR execution, native decompilers and Rust/Wasm runtime
execution are not provided or qualified by this inventory.
