# JavaScript runtime project delivery

The complete requested scope is [project 7](https://github.com/users/wieslawsoltes/projects/7).
`runtime-a05-scope.json` is the historical 41-item capture from 2026-10-03.
The current [Project 7 acceptance audit](a05-project7-acceptance-audit.md) accounts
for all 83 open issues and their 210 stated criteria in the newer 108-issue capture.
Pending entries remain delivery requirements, not declared capabilities.

The E03/E04 and defect qualification counts below are historical and apply only
to the revisions in their linked JSON. They are not a passing claim for the
current integration or its new memory, control, compiler and snapshot features.

Implementation is staged in worktrees and stacked pull requests. Validation runs once
a complete epic scope has been integrated, followed by targeted reruns only for fixes.

| Epic | Scope | Delivery |
| --- | --- | --- |
| SF-A05-E03 (#461) | T13–T20: interpreter modules, dispatch registry, shared intrinsic signatures, snapshot schema | [PR #1330](https://github.com/wieslawsoltes/SharpForge/pull/1330), CI passed |
| SF-A05-E04 (#462) | T21–T28: static initialization, runtime types, casts, tokens, enums, statics, strings, engine parity | Implemented and validated; see `runtime-a05-e04-validation.json` |
| SF-A05-E01 (#72) | T01–T06, T29–T31 and B01–B04/B06: execution correctness, async, synchronization, preemption | In progress; B01–B06 delivered in [PR #1448](https://github.com/wieslawsoltes/SharpForge/pull/1448) |
| SF-A05-E02 (#73) | T07–T12 and B05: decode caches, numeric specialization, frames, profiling, Wasm tier, performance gates | Pending |

The initial branch starts at `7f0ca223d1b9a07725078260020019cfb276c241`.
Before implementation, origin had no open PRs and the checkout had only `main`;
the portfolio had no active agent claims. The E03 leaf tasks have disjoint project
file locks. The verifier intrinsic adapter is included in T17's explicit integration
lock, and the scheduler exception-root adapter is included in T20's lock.

## Engine parity gate (T28, E04)

[T28](https://github.com/wieslawsoltes/SharpForge/issues/724) belongs to E04
(parent #462). `tests/engine-parity.test.js` runs in the existing `npm test` CI
command. It automatically discovers shared `tests/fixtures/language/*.js`
catalogs, exported `*ExecutionCases` from test fixture modules, studio sample
catalogs, and source-bearing example manifests. The original compiler and
language regression tests consume the same extracted catalog arrays, so added
rows enter both suites. Generated examples use `sampleSources`, preserving the
actual generated source and compilation options.

Each executable fixture runs through source compilation and `VirtualMachine`,
emitted assembly reloading and `VirtualMachine`, and direct `CilVirtualMachine`.
The gate compares output, known exception type identity, signed exit code and
terminal state, with fresh heaps, virtual scheduling time and finite instruction
budgets. Negative compilation fixtures must reject in both compiler entry paths;
they cannot provide executable images. Runtime fault and budget-boundary fixtures
exercise the exception comparator. This gate qualifies the repository compiler's
language profile; independent Roslyn DLL/native .NET qualification remains a
separate E04 runner.

`tests/support/engine-parity-allowlist.js` records two observed differences in
managed heap byte totals for the `gc` and `particles` samples. Each allowance
names the exact fixture, owner, reason and tracking issue, and permits only the
observed values. Cases always compile and execute; exception types, state and
exit codes cannot be exempted. Unknown values and obsolete allowances fail.

E04 passes 3,282 Node tests with zero skips, 303 syntax checks, worker bundling,
all 25 package installation checks, and 51 Chromium checks. Four independent
Roslyn DLLs produce identical output under native .NET 10 and CIL. Another
86-pair fixture compares native Type.IsAssignableFrom with CastCache directly;
this does not claim that the interpreter executes the reflection oracle DLL.
Exact revisions, commands, reports and unsupported targets are recorded in
`runtime-a05-e04-validation.json`. Run `node scripts/validate-a05-type-system.js`
with `--dotnet <executable>` to repeat native qualification.

| E04 capability | Source VM | CIL VM |
| --- | --- | --- |
| Enum names, boxing, flags, numeric casts | Registered framework enums | Framework and metadata-defined enums, all integral widths |
| String interning and reference identity | Shared managed intern pool | Shared managed intern pool |
| Runtime types and cached casts | Source MethodTables and GetType | Metadata MethodTables, handles, GetType, variance and array casts |
| Generic and thread statics | Source language profile | Closed generic ownership, scheduler-local ThreadStatic storage |
| Type initialization | Source lowering | Precise/beforefieldinit triggers, failure caching and re-entrancy |
| Volatile access | Cooperative instruction ordering | Verified volatile prefixes and cooperative instruction ordering |

At that E04 revision, the source frontend did not accept arbitrary user enum
declarations, `typeof`, or user generic type declarations. Later compiler work
changes that boundary; current support requires the end-to-end tests recorded in
the acceptance audit. Historical native results are qualified on macOS arm64 and
.NET 10.0.5; no host-thread memory model is claimed.

## Snapshot schema

Both engines use `snapshotSchemas` in `packages/runtime/src/snapshot.js`. Each
schema lists execution fields and their copiers, component snapshot adapters, and
host or derived fields deliberately retained across restore. Snapshot objects carry
`schemaVersion`, `engine`, and VM ownership. Unsupported versions and missing
required fields are rejected before restoring execution state. Every own VM field
must be registered; adding an execution field without a schema entry fails the
schema coverage test and snapshot capture.

Schema2 in-memory snapshots retain their original VM ownership. The separate
portable version1 format encodes code/type/reference identities and rebinds them
to a fresh VM with the same verified code and native width. Host revision checks
remain mandatory. Both paths validate captured memory, scheduler and continuation
state before replacing live components. Source restore pauses runnable state;
CIL restore retains captured debugger/run state. Explicitly resume a restored
CIL debugger pause before calling `run()`.

Managed frame identifiers remain monotonic. Shared graph copying retains fault,
frame and typed-buffer aliases without aliasing mutable live storage. Immutable
heap record sharing has a full-copy comparison mode; see
[shared snapshot limits](a05-snapshot-cow.md) and
[portable API](runtime-a05-portable-snapshots.md).

Run the replay example with `node examples/runtime/snapshot-replay.mjs`.

| API/capability | Source VM | CIL VM | Regression evidence |
| --- | --- | --- | --- |
| Versioned in-memory snapshot and restore | Schema 2 | Schema 2 | `tests/a05-06-coherent-snapshot.test.js` |
| Unknown execution-field detection | Explicit schema coverage | Explicit schema coverage | Same suite |
| Portable serialized snapshots | Version 1, fresh owner | Version 1, fresh owner | `tests/a05-06-portable-snapshot.test.js` |

These rows describe implemented contracts. Full parked-context replay,
worker/browser transfer and final-revision performance qualification remain
tracked by the acceptance audit. Run the portable example with
`node examples/runtime/portable-snapshot.js`.

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
