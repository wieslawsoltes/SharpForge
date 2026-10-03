# JavaScript runtime project delivery

The complete requested scope is [project 7](https://github.com/users/wieslawsoltes/projects/7).
`runtime-a05-scope.json` records all 41 board items and their acceptance criteria as of
2026-10-03. Pending entries remain delivery requirements, not declared capabilities.

Implementation is staged in worktrees and stacked pull requests. Validation runs once
a complete epic scope has been integrated, followed by targeted reruns only for fixes.

| Epic | Scope | Delivery |
| --- | --- | --- |
| SF-A05-E03 (#461) | T13–T20: interpreter modules, dispatch registry, shared intrinsic signatures, snapshot schema | [PR #1330](https://github.com/wieslawsoltes/SharpForge/pull/1330), CI passed |
| SF-A05-E04 (#462) | T21–T27: static initialization, runtime types, casts, tokens, enums, statics, strings | In progress |
| SF-A05-E01 (#72) | T01–T06, T28–T31 and B01–B04/B06: execution correctness, parity, async, synchronization, preemption | Pending |
| SF-A05-E02 (#73) | T07–T12 and B05: decode caches, numeric specialization, frames, profiling, Wasm tier, performance gates | Pending |

The initial branch starts at `7f0ca223d1b9a07725078260020019cfb276c241`.
Before implementation, origin had no open PRs and the checkout had only `main`;
the portfolio had no active agent claims. The E03 leaf tasks have disjoint project
file locks. The verifier intrinsic adapter is included in T17's explicit integration
lock, and the scheduler exception-root adapter is included in T20's lock.

## Snapshot schema

Both engines use `snapshotSchemas` in `packages/runtime/src/snapshot.js`. Each
schema lists execution fields and their copiers, component snapshot adapters, and
host or derived fields deliberately retained across restore. Snapshot objects carry
`schemaVersion`, `engine`, and VM ownership. Unsupported versions and missing
required fields are rejected before restoring execution state. Every own VM field
must be registered; adding an execution field without a schema entry fails the
schema coverage test and snapshot capture.

Snapshots remain in-memory and scoped to their original VM. Host operations retain
the existing revision checks. Source restore pauses execution; CIL restore retains
the captured run state. Managed frame identifiers remain monotonic. Frames retain
code metadata while mutable execution state is copied with shared fault aliases.
Maps, sets, and typed buffer views are copied without aliasing the live execution.

Run the replay example with `node examples/runtime/snapshot-replay.mjs`.

| API/capability | Source VM | CIL VM | Regression evidence |
| --- | --- | --- | --- |
| Versioned in-memory snapshot and restore | Schema 1 | Schema 1 | `tests/a05-seams-snapshot.test.js` |
| Unknown execution-field detection | Explicit schema coverage | Explicit schema coverage | Same suite |
| Portable serialized snapshots | Pending T06; no capability claim | Pending T06; no capability claim | Pending |

## Qualification

E03 passed all 2,634 Node tests (zero skipped), syntax checks, worker bundling,
package verification, the snapshot replay example, and Chromium managed-CIL,
advanced-debugger, and runtime suites. Exact code commit, commands, tool versions
and browser results are in `runtime-a05-e03-validation.json`. The original Node 16
on the shell PATH and macOS temporary-directory symlinks required a Node 24 PATH
and a physical TMPDIR for the existing test harness. No native CLR qualification
is implied by synthetic IL fixtures.

## Runtime defect scope

The second stack layer fixes B01–B06: unsigned integer widening, .NET 10 floating
conversion saturation, virtual declaration slots and explicit MethodImpl, typed
runtime exception inheritance, per-method offset-map reuse, and exact Int64 GC
results with valid generation counters. Source Int32 casts and constant folding
share the corrected conversion policy. The GC return contract is preserved through
source compilation, emitted IL, locals, boxing and string formatting.

All 2,758 tests passed. Native .NET 10 checks qualify 90 conversion cases, seven
Roslyn widening cases, virtual dispatch, and typed exception handlers against the
same assemblies executed by CIL. Managed-CIL and runtime Chromium checks, worker
bundling and package verification also passed. Evidence and platform limitations:
`runtime-a05-bugs-validation.json`. Native qualifiers are runnable through the three
`scripts/validate-a05-*.js` / `.mjs` scripts.

The seven-sample interleaved `fib(25)` measurement recorded median 947 ms before
and 761 ms after (1.24x), with Map allocations reduced from 242,786 to 2. This is
development-host evidence; the broader T12 performance gate remains pending.
