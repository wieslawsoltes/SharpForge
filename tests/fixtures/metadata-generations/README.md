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
  tests/a03-24-metadata-generations-native.test.js \
  tests/cil-table-widths.test.js \
  tests/a03-03-pe-reader.test.js \
  tests/a13-14-metadata-tables.test.js \
  tests/a13-14-metadata-heaps.test.js \
  tests/a13-14-metadata-native.test.js \
  tests/a13-05-pdb-generations.test.js
```

The existing A03 manifest's `tests/a03-*.test.js` glob owns the five focused
files. The six explicit adjacent files cover the shared table reader, PE envelope,
metadata inspector and PDB generation consumers. This eleven-file command is the
planned regression gate; no broad suite has been run for this work.

`browser.mjs` exports the established `run()` report. It loads both retained
corpora, checks their SHA-256 values, replays native facts and checks owned inputs
and outputs, historical rows, malformed maps, ordinal mismatch, option-getter
reentrancy, bounds, cancellation and disposal. Browser execution is deferred;
Chromium, Firefox and WebKit need actual observations. Windows/macOS native and
other host results remain unverified. This JavaScript metadata API does not add a
source-VM, direct-CIL or Rust/Wasm implementation or claim those engines passed.

## Source-pinned performance protocol

`validation-plan.json` is the complete scheduled plan. It expands the five
focused and six adjacent test filenames, capture/provenance/retention steps,
minimal sparse baseline preparation, public aliases, exact commands and estimated
disk allowances. The plan and tools are prepared; none of their scheduled commands
has run for this batch. Product source remains at
`02df6354e3152beac511d29b20272050ae03f486`.

The comparison baseline is exactly main
`31900dce5c1454c1f9c244c9ac14e1798eac3e5f`. The driver requires a clean minimal
sparse checkout with its own five public package aliases. It creates no checkout,
installs nothing and never changes measured source. Both sides' declared CIL
source dependency closures, package manifests and public entry resolutions are
hashed before loading product code and checked again after measurement.

After successful native retention and the explicit eleven-file gate, commit the
actual reference and evidence so the candidate is clean. With the scheduled
heavy slot and quiet team host, run once from the candidate checkout:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=2048 \
  node scripts/limited.js node packages/cil/tools/benchmark-metadata-generations.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-metadata-generations-baseline-31900dce \
  --output /workspace/scratch/7e3d2a445c44/project6-metadata-generations-performance.first
```

The destination must be new and outside both checkouts. Baseline and candidate
preparation run in separate processes and prove identical inputs and complete
reader facts before any timed batch. The small input is the existing structural
metadata fixture. The real input is the retained 11,776-byte Roslyn CFG PE image;
its embedded metadata is also measured independently. The exact fixture source,
native record and image SHA-256 values are fixed in the protocol. The new mixed
generation corpus is pinned to its committed native reference git blob and
artifact hashes before the first child starts.

| Workload | Operations per batch | Timing scope |
| --- | ---: | --- |
| Default `readMetadata`, structural/real | 128 / 64 | One-argument public physical reader |
| Default `readPE`, structural/real | 128 / 64 | One-argument public PE reader including its metadata decode |
| Explicit bounded readers, same four inputs | 128 / 64 | Candidate-only `maxRows` equal to the physical row total |
| Generation construction | 25 | Owned history construction from mixed baseline PE |
| First and second append, separately | 25 each | One append; preceding history is prepared outside timing |
| Entity and heap introduction mapping, separately | 1,000 each | Fixed equal mixture of four probes |
| Latest and historical row, separately | 1,000 each | `Added` raw record at generations 2 and 1 |
| Heap entry reads | 400 | Equal mixture of Strings, Blob, GUID and Unicode user-string probes |

Each workload has exactly 20 warm batches and 100 measured batches. Default
controls run in distinct processes with a fixed alternating baseline/candidate
order. Four separately reported candidate budget controls follow, then one
candidate-only feature process. The parent and baseline reader processes never
import the candidate feature module. The reader worker's two dynamic import sites
load only verified local public package entries and the fixed structural helper;
the existing static policy binds their exact source hash and count.

Every returned reader value is retained and compared after timing, including
all data fields, field order, heap bytes and borrowed buffer/PE identity.
Preparation and final guards also check row/list/type callbacks, referenced heap
values, owned GUID getter values and every default method-body outcome. Default
unsupported method-body results remain explicit; inspection-only guard reads
compare the five retained native CIL byte sequences. Each bounded control proves
that one row below its actual count rejects before timing. Native replay checks
the feature corpus before timing; construction/appends receive full history
guards and every query return is consumed and compared.

The report retains all 2,400 warm/measured batches in chronology, exact child jobs
and commands, raw stdout/stderr, exit status/signal, input/native/source/tool
hashes and actual environment. True median and nearest-rank p95/p99 describe the
100 **batch means in microseconds per operation**, not individual-call latency
percentiles. Import/startup, fixture preparation, native replay, guards, disposal,
statistics and I/O are outside timing. There is no cold-start timing claim.

Signed net Node heap deltas are recorded for each batch. These deltas include GC
effects and do not represent total allocations or all ArrayBuffer/native memory;
the report also retains process memory and shared-host load observations. It
forces no GC and makes no peak-memory claim. Preserve the entire first output,
including failures, partial records and absent-result diagnostics. A source fix
or justified retry needs a new separately retained cohort.

No benchmark has run and no performance exception is approved. Independently
recompute statistics from the retained raw samples, preserve absolute costs and
all regressions, and obtain explicit quantified PR sign-off for an existing
median regression above 5%. Successful correctness guards never approve a
performance regression.
