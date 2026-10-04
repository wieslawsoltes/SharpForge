# Changed-method Portable PDB emission

`emitPortablePdbDelta(debug, generation, options = {})` emits a standard minimal
Portable PDB using `#-`, `#JTD`, wide references and an increasing EncMap. Only
the explicitly supplied changed methods receive MethodDebugInformation rows.
Input method order does not affect output bytes. The baseline PDB builder and
delta writer share the envelope serializer, heap interning and existing debug
codecs; the baseline wire format is unchanged.

```js
import { emitPortablePdbDelta } from '@sharpforge/symbols';

const delta = emitPortablePdbDelta({
  sources: [{ uri: 'Program.cs', text: 'return 42;' }],
  methods: [{
    token: 0x06000002,
    codeSize: 6,
    localSignature: 0,
    points: [{ offset: 0, document: 1,
      startLine: 1, startColumn: 1, endLine: 1, endColumn: 11 }],
    scopes: [{ start: 0, end: 6, locals: [], constants: [] }],
  }],
}, {
  baselineId: symbols.baselineId,
  previousPdbId: symbols.pdbId,
  generation: symbols.generation + 1,
  typeSystemRowCounts: aggregateCountsAfterMetadataDelta,
  deltaRowCounts: actualMetadataDeltaCounts,
});
symbols.append(delta.bytes, delta);
```

`generation` requires the complete 40-hex-digit baseline and previous PDB ids,
a generation ordinal from 1 through 1,023, authoritative aggregate
`typeSystemRowCounts`, and actual generation-local `deltaRowCounts`. EncLog and
EncMap counts are excluded from both CLI count objects. The delta MethodDef
count must equal the number of supplied changed methods; no delta count may
exceed its aggregate count. Aggregate counts are used for validation and local
signature/import/type/async targets; only `deltaRowCounts` is written to `#Pdb`.

The result contains `{ bytes, id, checksum, pdbId, baselineId, previousPdbId,
generation, typeSystemRowCounts, deltaRowCounts }`. Identity linkage is an
explicit sidecar envelope. No nonstandard baseline field is inserted into the
PDB. Its consumer must pair that envelope with the correct CLI/IL generation.
The writer does not emit CLI metadata deltas, apply runtime updates, or verify
instruction boundaries against IL bodies; `codeSize` is supplied by that owner.

## Input records

- `sources` use the ordinary source writer shape: `uri`, `text` or `bytes`,
  optional hash, hash algorithm and language GUID. Document ids are their
  one-based input order. Optional `embedSources: true` emits embedded-source CDI.
- `methods` contain aggregate MethodDef `token`, IL-byte `codeSize`, aggregate
  StandAloneSig row `localSignature` (default zero), ordered `points`, and optional
  lexical `scopes`. Point shape matches `readPortablePdb`; hidden points can use
  `hidden: true`. Every point must refer to an input document and lie inside the
  supplied body. Optional `document` is zero for a multi-document method or the
  single document id. It is inferred when omitted.
- `scopes` use byte `start` / exclusive `end`, `locals` with `slot`, `name` and
  optional `hidden`, typed or raw-signature `constants`, and `importScope`.
  Existing lexical scope rules apply, including a root spanning the body.
- `importScopes` use the ordinary writer's kinds 1–9 and parent-before-child
  order. Their ids are local to this delta.
- `stateMachines` contain aggregate MoveNext/kickoff token pairs. MoveNext must
  be among the changed methods; its emitted handle is delta-local. Kickoff
  remains aggregate.
- `custom` contains `{ parent, kind, bytes }`. Supply explicit raw bytes, using
  `writeCustomDebugInformation` first when starting from structured CDI. Method
  parents are aggregate and must be changed methods; they are remapped to local
  row ids. Local/document/import parents already refer to delta-local rows.
  Async resume method ids inside CDI remain aggregate. Unknown kinds retain
  their bytes; known kinds receive the same read-time validation as other PDBs.

An empty sequence-point blob cannot encode a nonzero local signature, so that
combination fails explicitly. Source point omission, duplicate methods, bad
references, invalid scalar ranges, malformed CDI and invalid scope lists fail
before any result is returned. New writer-specific errors are
`PDB_DELTA_INPUT`, `PDB_DELTA_BUDGET` and `PDB_DELTA_CANCELLED`; generation and
codec errors retain their existing codes/types.

## Bounds and qualification

Options `maxBytes` (64 MiB), `maxSourceBytes` per document (16 MiB), `maxRecords`
(100,000) and `maxPoints` (1,000,000) may lower their defaults but cannot exceed
them. The record budget includes metadata inputs, EncMap entries and import
definitions; the conservative input-byte budget charges string fields at three
bytes per UTF-16 unit plus raw source/signature/CDI payloads. Output size is
checked separately. Existing symbol-reader budgets remain active. `signal`
checks cancellation before and during emission. Work is O(input + emitted
bytes), plus O(changed methods log changed methods) for canonical ordering.

Run the independent SRM check only in the assigned serial validation slot,
after capturing the real Roslyn generation fixtures:

```sh
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-delta-writer.mjs --capture tests/fixtures/portable-pdb-delta-writer
node scripts/limited.js node --test tests/a13-05-pdb-delta-writer.test.js tests/a13-05-native-delta-writer.test.js
```

The check reuses native Roslyn method points and actual metadata delta counts,
emits the PDB with SharpForge, then asks native SRM to read its EncMap, methods,
scopes, constants and opaque CDI. The capture records SDK/runtime, native-reader
source and output SHA-256 identities. Native debugger/ApplyUpdate behavior,
browser execution and Rust/Wasm are independent qualification targets. No native
claim is made until this capture succeeds.
