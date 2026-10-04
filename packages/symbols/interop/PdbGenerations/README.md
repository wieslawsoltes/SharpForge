# Portable PDB generation reader

`readPortablePdbDelta(bytes, { typeSystemRowCounts, ...readerOptions })` reads a
minimal Portable PDB delta. `typeSystemRowCounts` is a table-number keyed object
containing authoritative **aggregate** CLI table counts after applying the
matching metadata delta. It is required: a native PDB delta's `#Pdb` stream
contains generation-local counts and cannot validate aggregate handles alone.

The returned shape matches `readPortablePdb`, plus `isDelta: true` and an owned
`typeSystemRowCounts` copy. `methods[].token`, LocalScope method tokens, method
CDI parents and StateMachineMethod MoveNext tokens are projected through EncMap.
State-machine kickoff, async resume, local-signature and imported type/assembly
references already use aggregate CLI identities. Document/import/local row ids
remain local to the PDB generation. `metadata` retains the original physical
rows, generation-local external counts and byte offsets for inspection.

The explicit delta path requires `#-`, the empty `#JTD` marker, and a strictly
increasing `EncMap` with one MethodDebugInformation handle per MDI row. It rejects
other non-debug tables and invalid local method references. Baseline parsing
keeps its existing dense-row checks and rejects delta metadata.

## Aggregate lookup

```js
import { PortablePdbGenerations } from '@sharpforge/symbols';

const symbols = new PortablePdbGenerations(baselinePdbBytes);
const frameBeforeEdit = symbols.getMethodByVersion(0x06000002, 1);
symbols.append(deltaPdbBytes, {
  baselineId: symbols.baselineId,
  previousPdbId: symbols.pdbId,
  generation: 1,
  typeSystemRowCounts: countsAfterMetadataUpdate,
});
const original = symbols.location(0x06000002, 0, 0);
const updated = symbols.location(0x06000002, 0, 1);
const originalDocument = symbols.getDocument(original.document, original.generation);
symbols.dispose();
```

Generations start at zero; reader versions start at one. `getMethod(token,
generation = latest)` and `getMethodByVersion(token, version)` select the newest
update at or before that generation. The result includes its source `generation`,
`version`, per-method `revision` (starting at one), sequence points, scopes and
method-parent CDI records. Unchanged methods keep their earlier generation and
revision. `location(token, ilByteOffset, generation = latest)` resolves one point
without copying the entire method; hidden points return null. `getDocument(id,
symbolGeneration)` returns an independent document/hash/source snapshot.

Inputs are parsed into owned symbol facts; returned methods/documents are copies.
An append validates the entire delta before publishing it. The identity envelope
must contain matching 40-digit `baselineId` and `previousPdbId`, the immediately
following generation, and nondecreasing aggregate row counts. Optional `pdbId`
also checks the new file's complete content id. These are caller-provided pairing
checks, not proof that a native PDB file encodes its baseline: the standard delta
does not contain that linkage. A14 owns metadata/runtime generation coordination.

`SymbolError.code` distinguishes `PDB_BASELINE_MISMATCH`,
`PDB_PREVIOUS_GENERATION_MISMATCH`, `PDB_GENERATION_MISMATCH`, `PDB_GENERATION_ID`,
`PDB_DELTA_FORMAT`, `PDB_DELTA_TABLE`, `PDB_DELTA_MAP`, `PDB_DELTA_METHOD`,
`PDB_DELTA_COUNTS`, `PDB_METHOD_TOKEN`, `PDB_METHOD_OFFSET`, `PDB_DOCUMENT_ID`,
`PDB_GENERATION_LIMIT`, `PDB_GENERATION_BUDGET`, and `PDB_GENERATIONS_DISPOSED`.
Existing codec errors remain SymbolError. An optional append `signal` cancels
parsing; cancellation/rejected appends preserve the previous generation.

Constructor limits default to 64 generations (including baseline), 128 MiB total
retained PDB bytes and 500,000 retained metadata rows. `maxGenerations`,
`maxRetainedBytes` and `maxRetainedRecords` may be changed up to hard caps of
1,024, 1 GiB and 1,000,000. `readerOptions` applies the existing per-file parse
budgets. `dispose()` releases histories and all future reads/appends fail;
previously returned copies remain usable. Construction/append is linear in the
new PDB's records. Method lookup is O(log revisions + returned data); location
lookup is O(log revisions + log sequence points). No dense baseline is rebuilt.

## Reproduce native evidence

Run only in the repository's assigned serial validation slot:

```sh
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-generations.mjs --capture tests/fixtures/portable-pdb-generations
node scripts/limited.js node --test tests/a03-24-minimal-delta.test.js tests/a13-05-pdb-generations.test.js tests/a13-05-native-generations.test.js
```

The harness references Roslyn assemblies from the selected SDK; no NuGet package
is added. Roslyn emits a baseline and two actual EmitDifference updates, first
changing method 2 and then method 1. Native SRM reads each method's exact points,
local signature, scopes and local names. The script compares JavaScript parsing
and historical lookups before capturing files, SHA-256 identities, SDK/runtime
and compiler version. The fixture is a runnable example, not a runtime simulator.
It never calls CLR ApplyUpdate or executes edited methods. Browser, native
debugger and Rust/Wasm behavior require their own qualification. Until capture
succeeds, native evidence is pending; constructed fixtures are identified as such.

Primary implementation sources (blob identities read 2026-10-04):

- [Roslyn DeltaMetadataWriter](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/Emit/EditAndContinue/DeltaMetadataWriter.cs), `5a69d285aa76aedefbd258af186b229693945cdd`.
- [Roslyn Portable PDB writer](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/PEWriter/MetadataWriter.PortablePdb.cs), `caaf5b320f31dcd726c3f06223cee16b52b620c4`.
- [SRM MetadataSizes](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataSizes.cs), `5a7d6ce08f3aa6a87e5e1c7f1a7f0241c0b67b34`.
- [Portable PDB specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md), `5d0bf48e34b2220615038a6d0c9636338a4c1530`.
