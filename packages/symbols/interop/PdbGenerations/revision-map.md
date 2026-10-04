# Generation-bound symbol snapshots

`PortablePdbRevisionMap` is a symbol-side adapter for caller-owned frame identity.
It does not define or apply the runtime's Hot Reload generation contract. The
caller explicitly supplies `{ baselineId, generation, methodToken, revision }`.
Every component must match the selected method's recorded history.

```js
import { PortablePdbRevisionMap } from '@sharpforge/symbols';

const revisions = new PortablePdbRevisionMap(symbols);
const oldFrame = revisions.capture({
  baselineId: symbols.baselineId,
  generation: 0,
  methodToken: 0x06000002,
  revision: 1,
});
symbols.append(delta.bytes, delta);
const oldLine = oldFrame.location(0); // Still generation 0's source line.
const oldMap = oldFrame.points;
oldFrame.dispose();
revisions.dispose();
```

`capture(reference, { signal })` returns a snapshot with a frozen `reference`,
owned-copy `points` getter, `location(ilByteOffset)`, `getDocument(documentId)`,
`disposed`, and idempotent `dispose()`. Its reference separates the caller's
`generation` from the method map's `symbolGeneration`: an unchanged method can
run in generation 2 while still using generation 0's symbols and revision 1.
Revisions count each method's own updates, starting at one. They are not the
same as module generation plus one.

Snapshot lookups never consult the current generation. They continue working
after later symbol updates and after the original `PortablePdbGenerations` is
disposed. Each document lookup returns name/language/hash identity metadata;
embedded source payloads are excluded. Mutating returned points, hashes or
document objects cannot change later queries.

Snapshots of the same method/symbol-generation/revision share one private map.
The last disposed snapshot releases that map. Disposing the revision map
disposes all active snapshots, releases its cache and provider, and prevents new
captures. Previously returned record copies remain usable. Callers retain and
dispose frame snapshots explicitly; the cache does not depend on finalization.

Constructor options default to `maxSnapshots: 256`, `maxPoints: 1_000_000`, and
`maxDocuments: 10_000`. Hard caps are 10,000 / 1,000,000 / 100,000 respectively.
Point and document budgets count cache entries once per method revision, rather
than once per frame lease; a document shared by different method maps is charged
once in each map. Zero point/document budgets are permitted. Rejected captures
do not consume a lease or cache budget. Optional pre-aborted `signal` rejects
capture without changing previous snapshots.

Errors distinguish `PDB_BASELINE_MISMATCH`, `PDB_GENERATION_MISMATCH`,
`PDB_METHOD_REVISION_MISMATCH`, `PDB_REVISION_SOURCE`, `PDB_REVISION_LIMIT`,
`PDB_REVISION_BUDGET`, `PDB_REVISION_CANCELLED`, `PDB_REVISION_MAP_DISPOSED`, and
`PDB_SYMBOL_SNAPSHOT_DISPOSED`. Existing invalid method/offset/document codes
remain in use. A missing generation is rejected instead of selecting latest.

The generation provider now offers `getMethodRevision(token, generation)` for
scalar `{ methodToken, generation, revision, pointCount }` facts and
`getSequencePoints(token, generation)` for point-only copies. Both default to the
latest generation and use the same indexed history. `getDocument(id, generation,
{ includeSource: false })` avoids cloning embedded source bytes. These seams keep
frame binding independent of scope/CDI/source-body size.

Cold capture is O(log method revisions + sequence points + referenced document
metadata); repeated captures of the same map are O(log method revisions).
Snapshot location is O(log sequence points) and returns only one point object.
The focused regression test covers historical lines, exact identity mismatch,
unchanged methods, copy ownership, cancellation, cache budgets and disposal.
The native Roslyn corpus qualifies the symbol facts consumed by this adapter;
native CLR/Visual Studio active-frame binding and Rust/Wasm runtime integration
are separate, unqualified surfaces. Browser execution requires a separate run.

## Recorded qualification

The retained Roslyn/SRM corpus contains a baseline and two real updates captured
with SDK 10.0.201 and CoreCLR 10.0.5. The native snapshot regression checks this
adapter's exact historical method maps against those recorded facts. The
separate writer corpus retains the SharpForge-produced PDB accepted by native
SRM, including its scopes, constant and opaque custom debug record.

Before this integration, the combined writer, revision-map and existing
Portable PDB regression run passed **48 tests, with zero failures, cancellations
or skips**. The unchanged original log is retained in
`tests/fixtures/portable-pdb-delta-writer/qualification/pre-integration-node.tap`,
with provenance recorded alongside it. The log does not encode its exact
checkout commit or Node version. These are prior results; root's post-merge
tests, core gates and benchmarks are pending.

The browser corpus is implemented but has **not been run**. Native active-frame
binding, managed ApplyUpdate, Visual Studio integration and Rust/Wasm runtime
behavior remain unqualified. No performance result is claimed before the
coordinated benchmark run.

## Reproduce validation and measurements

The native snapshot test consumes the pinned Roslyn/SRM corpus generated by the
[generation harness](README.md#reproduce-native-evidence). Run the focused
tests and correctness-gated benchmark through the repository's serial wrapper:

```sh
node scripts/limited.js node --test tests/a13-05-revision-map.test.js tests/a13-05-native-revision-map.test.js
node scripts/limited.js node --expose-gc packages/symbols/benchmarks/pdb-generations.mjs
```

Both benchmark drivers use 20 warmup rounds followed by 100 measured rounds for
each operation, alternating forward/reverse workload order. A separate first
timed call follows untimed correctness checks; it is **not process-cold**.
Reports retain every first, warmup and measured sample in chronological order.
Median averages the middle two measured values; p95 and p99 use nearest rank.
Only the named operation is timed. Every returned result is consumed and checked
after timing; disposal and memory observation also occur outside the interval.
Observed heap/ArrayBuffer changes include garbage collection and are not total
allocator counts. Reports include an environment snapshot, Git commit/tree,
package manifest/source hashes, benchmark source hashes and fixture hashes.

The generation driver checks all retained native artifact hashes, method maps,
local signatures, scope names, documents, historical snapshot isolation and
disposal before timing. It separately labels read/append, first capture with a
new empty cache, repeated capture with a held cache lease, history lookup and
snapshot lookup. These are new API costs, without a baseline speedup claim.

The existing emit/read/load comparison keeps its original compiler input,
200-line document fixture and API arguments. Outside timing it requires
byte-for-byte equality of baseline/current emitted PDBs and attached images,
checks the embedded source checksum and bytes, method tokens and empty point
maps, and compares read/load facts and assembly binding. Each checkout resolves
its own public packages and declared workspace dependency closure; mixed-source
aliases, modified tracked files and an unexpected baseline commit fail before
measurement. The baseline path is trusted local operator input, not data read
from an assembly. Install dependencies separately in both selected checkouts.

Run the comparison from the clean candidate checkout, retaining stdout as JSON
outside either checkout; substitute the path to the pinned baseline checkout:

```sh
node scripts/limited.js node --expose-gc scripts/bench-pdb.js \
  --baseline /path/to/sharpforge-baseline \
  --baseline-revision 8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c
node scripts/limited.js node --expose-gc packages/symbols/benchmarks/pdb-generations.mjs
```

Neither driver has been run for this integrated candidate. Preserve the raw JSON
from the coordinated run before reporting results. The generation benchmark
compares a retained native corpus; it does not launch CoreCLR or apply an update.

The source-module browser entry point is
`tests/fixtures/portable-pdb-generations/browser.mjs`. Serve the repository with
the package import map and call its exported async `run()` under each actual
Chromium, Firefox and WebKit engine. It fetches the retained native corpora,
checks SHA-256 hashes, compares native symbol facts, re-emits the SRM-accepted
delta byte-for-byte, and exercises history/snapshot identity, cache budgets,
cancellation, malformed tokens/maps and disposal. Its result records the native
reference versions and explicitly distinguishes corpus comparison from a live
native invocation. Record browser versions, source commit and command with the
scheduled run; this entry point does not apply a managed Hot Reload update.
