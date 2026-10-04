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

Include the existing `tests/a13-07-cfg.test.js` and
`tests/a13-07-cfg-reference.test.js` in the coordinated run to check the unchanged
method reconstruction/CFG pipeline. Their retained fixture lives under
`tests/fixtures/decompiler-cfg`. A sparse validation checkout needs its own
public package aliases for CIL, bytecode, framework, bcl-core, bcl-collections,
symbols and archive; aliases must resolve to that checkout's package sources.

These new tests have not yet run. The authored browser entry point is
`tests/fixtures/decompiler-inventory/browser.mjs`; serve the repository package
import map and call its `run()` in each real Chromium, Firefox and WebKit engine.
Browser and other OS results remain pending. This is a JavaScript metadata/
decompiler feature; CLR execution, native decompilers and Rust/Wasm runtime
execution are not provided or qualified by this inventory.

## Controlled performance comparison

`packages/cil/tools/benchmark-decompiler-inventory.mjs` compares actual merged
main `c1693a9e322295a43d90c3335885b5b5b3cf8daa` with inventory product source
`7da8bdc75f834c1ebaa2c4b2585461fca80d7c97`. Documentation/tool commits may follow
the candidate, but any changed package source, package manifest or fixture
rejects the run. Each checkout resolves and hashes its own public CIL package
and complete declared workspace dependency closure. Mixed source aliases and
modified tracked files reject before dynamic imports or measurement. Checkout
paths are trusted operator input, never paths supplied by an assembly.

The benchmark reuses `arithmeticLibrary()` and the retained native CFG assembly,
with identical bytes for both libraries and separate inspector instances. It
reuses the CFG driver's alternating variant/rotating case protocol: 20 warmup
rounds and 100 measured rounds for each case/workload/variant. Each sample times
20 calls. Median averages the middle two samples; p95/p99 use nearest rank over
the **batch-mean ns/call** values, not individual-call tail latency. Every warmup
and measured sample remains in chronological order.

Three workloads keep default API overhead distinct from the new stage:

- `decompileAssembly.bytes` measures the full byte-input API, including the
  existing reader and inspector construction, for baseline and candidate.
- `decompileAssembly.cachedInspector` compares the same API using separate
  prewarmed inspector/method caches from each checkout.
- `inventoryOnly.cachedInspector` measures only candidate census, classification
  and option validation, using already computed method results. It has no
  baseline counterpart and must not be reported as a speedup.

Before measurement and after every timed batch, the driver checks all previous
assembly fields and every complete method result, including source, diagnostics
and CFG. It verifies every inventory table count, raw row, token, coordinate,
status count, declared-name summary and method-output link against the existing
baseline table inspector; repeated and isolated inventories must match the full
candidate API result exactly. Every returned result is consumed outside timing.

The timed interval contains only API calls and storing their result references.
Each batch retains 20 results until its memory observation. Observed heap and
ArrayBuffer deltas include GC effects and retained output; they are not total
allocation counters. Reports include raw samples, source/fixture/output hashes,
Git commit/tree identities, runtime/CPU/OS facts and workload dimensions. Initial
imports and correctness guards are outside measurement, so no process-cold
latency is claimed. Whole-API changes also include replacing the legacy full
summary used only for the assembly name; the isolated workload identifies the
inventory stage's cost without treating the net change as a same-output speedup.

Run once in the coordinated quiet slot from a clean candidate checkout:

```sh
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-decompiler-inventory.mjs \
  --baseline /path/to/sharpforge-c1693a9e \
  --output /path/outside/checkouts/inventory-benchmark.json
```

The output must be a new file outside both checkouts; existing reports are never
overwritten. The driver has not been executed for this candidate. Performance,
including any default API overhead, remains unmeasured until that scheduled run.
