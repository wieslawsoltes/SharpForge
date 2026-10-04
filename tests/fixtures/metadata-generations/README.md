# CLI metadata generations — SF-A03-T24 / #693

The API, native observer, fixture generator and focused Node/browser checks are
prepared source. They have not been executed for this batch. No native result or
generated binary is present in this directory yet. Missing or failed native
evidence is a failing reference gate. The original Portable PDB generation corpus
is read from `../portable-pdb-generations` and remains byte exact.

The public API and its raw-row boundaries are documented in
`packages/cil/METADATA-GENERATIONS.md`. The API maps handles to their introducing
generation separately from choosing the latest physical row. It retains raw EnC
rows, signatures, list indices, RVAs and control operations; it does not reconstruct
full-metadata member ownership, relocate delta IL, or perform runtime ApplyUpdate.

## Independent native observations

`oracle/Program.cs` reads the baseline PE with native `PEReader` and both `.dmeta`
files with native `MetadataReaderProvider`, using `MetadataReaderOptions.None`.
For each prefix it records every physical row's native table width, offset and
bytes, native typed row fields, coded-reference entity handles, Module identities,
EncMap, EncLog and logical heap extents. Latest-row selection is derived separately
from native EncMap and physical rows, including the Module-row exception.

Native `MetadataAggregator.GetGenerationHandle` supplies introduction mappings for
entity and heap handles. Probes cover every available entity, typed nils, one future
row per present table, heap record starts, heap ends and future offsets. All GUID
indices through each aggregate extent are covered, including zero-filled history
and slots that map successfully but cannot be dereferenced in the selected physical
generation. GUID indices are not rebased. String extents use SRM's trimmed logical
heap size; Blob and user-string extents retain physical padding.

The observer records mapping and value-read outcomes independently. Native SRM can
return an empty string for a nonzero user-string handle addressing nil/padding or
an invalid length. The observer classifies the encoded extent with native
`BlobReader`; the replay explicitly checks the CIL reader's stricter rejection at
those boundaries. Nil value conventions are separate from exact handle mapping.
Those deliberate differences are not counted as successful value parity.

`replay.mjs` uses only public CIL APIs. It compares every returned scalar by
encoding it with the existing schema/index-width rules and matching native row
bytes. Named native fields and coded entity references are checked separately.
Ordinary public `readPE`/`readMetadata` calls provide the replay's physical width
context; these additional test reads are outside the production generation API.
Each production input is still parsed once. Earlier row snapshots are checked
again after both appends, and inverse physical mapping covers updates as well as
new rows. The fixture baseline is explicitly required to use compressed metadata;
the two minimal deltas use wide references and retain UInt16 scalar columns.

## Two real Roslyn corpora

The first corpus is the retained PDB-generation fixture: a baseline and two real
Roslyn metadata deltas with different updated methods. Its entire original artifact
manifest is verified before and after capture. Nothing is regenerated in that
directory. The first delta has a native nil `EncBaseId`; Module is omitted from
EncMap, GUID heaps include zero-filled historical slots, and the final string heap
has two alignment bytes beyond its logical extent.

`oracle/FixtureWriter.cs` creates a second corpus in a new output directory:

| Generation | Roslyn edits | User-string payloads |
| --- | --- | --- |
| Baseline | `Old` and `Stable` methods | `baseline` |
| 1 | Update `Old`; insert `Added` and `AddedField` | `first update λ`, `first insert` |
| 2 | Update the previously inserted `Added`; insert `AddedAgain` | `second update 😀`, `second insert` |

The generator uses the pinned SDK's Roslyn assemblies and `EmitDifference` with
actual update/insert edits. It records compiler and runtime versions, compiler
and compilation-reference hashes, generated C# sources, the baseline DLL/PDB,
both `.dmeta`/`.dil`/PDB deltas, and every artifact SHA-256. The generated code is
repository-authored fixture code under the repository's license. SDK/Roslyn/runtime
payloads are not copied into the repository; their existing license/provenance
policy is `planning/qualification/oracle-toolchain.json`. There are no new NuGet
packages or runtime product dependencies.

## Scheduled capture and verification

Use the serialized heavy-work slot and run from this frozen worktree. The five
public package aliases (`cil`, `bytecode`, `framework`, `bcl-core`,
`bcl-collections`) must resolve to this checkout; `capture.mjs` checks that fact
and hashes their complete declared source dependency closure. The pinned SDK
must be available. The driver reads its identity through the existing
`resolveToolchain` helper, enforces the shared pins and records the actual host.

Example scheduled command on the prepared Linux host:

```sh
SHARPFORGE_ORACLE_DOTNET=/workspace/scratch/7e3d2a445c44/dotnet-10.0.201/dotnet \
  node scripts/limited.js node tests/fixtures/metadata-generations/capture.mjs \
  /workspace/scratch/7e3d2a445c44/project6-metadata-generations-native.first
```

The final argument must be new or empty. The driver copies the observer source
and pinned `global.json` into that directory, builds one observer, creates the
mixed corpus, observes both corpora and performs the Node replay. Native processes
run serially with explicit time/output bounds and shared compilation disabled.
The observer reads metadata without invoking fixture methods or applying updates.

`native.json` records the frozen commit, complete source/tool hashes, public
package aliases, UTC timestamps, actual toolchain/host, exact build/create/observe
argv and working directories, elapsed times, exit status and signal, raw output
and output hashes, observer DLL hash, generated artifact hashes, native
observations and replay coverage. Process environment defaults come from the
hashed `scripts/conformance/oracle/process.js`; the driver records the resolved
toolchain environment and dotnet executable in each command. A failure is retained
before it is reported. Do not overwrite or discard a failed first capture.

Verify the successful capture without executing the product or managed code:

```sh
node scripts/limited.js node tests/fixtures/metadata-generations/verify.mjs \
  /workspace/scratch/7e3d2a445c44/project6-metadata-generations-native.first --strict-source
```

Strict mode checks every source/tool hash against the frozen checkout. All modes
enforce the existing toolchain pins, original/mixed artifact hashes, command
outcomes, raw output hashes and the equality of parsed native facts to retained
native stdout. This check does not convert a failed or missing capture to a pass.

After actual successful capture, retain `native.json`, the eight raw command logs
and `mixed/` under `tests/fixtures/metadata-generations/reference/`. Retain failed
attempts and the outer wrapper command/status evidence separately under
`qualification/`. The observer build's `project/`, `output/`, SDK and Roslyn DLLs
are temporary build inputs/outputs and are not fixture payloads for commit.

The focused native test expects that completed retention layout. Scheduled Node
checks, after capture and provenance retention, are:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a03-24-reader-budgets.test.js \
  tests/a03-24-minimal-delta.test.js \
  tests/a03-24-metadata-generations.test.js \
  tests/a03-24-metadata-generation-boundaries.test.js \
  tests/a03-24-metadata-generations-native.test.js
```

The existing A03 manifest's `tests/a03-*.test.js` glob owns these files. Adjacent
reader/PE/PDB risk checks are `tests/cil-table-widths.test.js`,
`tests/a03-03-pe-reader.test.js`, the three `tests/a13-14-metadata-*` files and
`tests/a13-05-pdb-generations.test.js`. Run only the concrete scheduled subset
needed for the shared-reader change; no broad suite has been run for this work.

`browser.mjs` exports the established `run()` report. It loads both retained
corpora, checks their SHA-256 values, replays native facts and checks owned inputs
and outputs, historical rows, malformed maps, ordinal mismatch, option-getter
reentrancy, bounds, cancellation and disposal. Browser execution is deferred;
Chromium, Firefox and WebKit need actual observations. Windows/macOS native and
other host results remain unverified. This JavaScript metadata API does not add a
source-VM, direct-CIL or Rust/Wasm implementation or claim those engines passed.

## Performance gate remains pending

The pre-change comparison source is main
`31900dce5c1454c1f9c244c9ac14e1798eac3e5f`. Measure ordinary default
`readMetadata` and `readPE` separately on unchanged common inputs, guarding all
preexisting fields, rows, heap and ownership facts outside timing. The optional
row-budget seam adds a default-path branch, so its cost cannot be inferred from
the new API alone. Report history construction, two appends, entity mapping,
latest-row lookup and heap access as separate new-feature costs.

Use one controlled 20-warm/100-measured cohort with chronological samples, true
median and nearest-rank p95/p99, source/tool/fixture hashes, actual environment and
explicitly labeled shared-host/heap observations. Preserve absolute costs and
all regressions. No benchmark has run and no performance exception is approved
for this batch. Correctness results do not constitute performance acceptance.
