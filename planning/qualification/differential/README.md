# Cross-engine differential qualification

Scope: #400 / A29 T04, actual leaves #1136–1142. Baseline `30fb0f8` contains the
pinned oracle tools and completed A00 contracts/registration. This implementation
owns adapters and reports; no compiler or runtime dispatch is modified.

With Node >=22 and the exact SDK in `oracle-toolchain.json` installed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/conformance/differential/differential.test.js
node --test tests/conformance/differential/engines.native.js
node scripts/conformance/diff/run.js
node scripts/conformance/diff/run.js --fixture hello --no-reduce
node scripts/conformance/diff/benchmark.js
```

Generic test registration discovers unit tests only. The dedicated differential
workflow separately runs `engines.native.js` with the pinned SDK on Linux x64,
Windows x64 and macOS arm64 on explicit dispatch, and retains artifacts
regardless of failure. It has read-only permissions and never creates issues.
Hosted image drift fails via the oracle pin checks; local OS runs are recorded
as local/unpinned. Missing SDK is a host failure, not a skipped native pass.

The report contains every raw and normalized repetition, actual assembly hashes,
compiler/runtime identities, unsupported adapters, difference classes, fingerprints
and reproduction paths. Repro folders include a corpus-compatible `fixture.json`,
`repro.cs`, `corpus.json` and reduction record. Replay with
`node scripts/conformance/diff/run.js --corpus <repro-directory>/corpus.json --no-reduce`.
Delta debugging removes C# statements and members
only while the same engine-pair/status/phase difference class persists; native
runs continue using the pinned oracle during minimization. A bounded run may
retain a larger reproducer and labels it budget-exhausted; it does not claim
minimality. Seeds fix corpus identity and reducer traversal order.

Eight examples cover deterministic arithmetic/Unicode, Int32/exit boundaries,
nested finally, signed zero, syntax rejection, unhandled faults, stdin and an
explicitly normalized clock. The seeded 200-line regression must reduce below
20 lines reproducibly using a real same-DLL runtime discrepancy. This native test
is separate from the pure reducer mechanics test.

Performance evidence reports cold/warm median/p95/p99 over ten runs after checks,
with exact VM managed-heap counters when exposed. Node heap deltas are not exact
allocation counts; native CLR/Rust process allocations are unavailable. Unsupported
A27 adapters are rows, never zero-time measurements or parity successes.

The local darwin-arm64 run passed nine unit tests and all three native tests,
including two identical reductions of the 207-line signed-zero program to fewer
than 20 lines. The full eight-fixture CLI retained four reviewed differences:
negative-zero formatting, extra CS1003 syntax diagnostics, missing Console.ReadLine
compilation and missing CIL Environment.TickCount support. The policy gate passes
with zero new differences while `parityPassed` remains false. Eighteen unsupported
rows cover the two A27 adapters for eight fixtures and stdin for the two JS VMs.

`passed` is the known-difference policy gate; it does not mean all engines agree.
`qualification` distinguishes clean committed runs from development worktrees.
The exact measured implementation SHA, tool versions, command results and timings
are retained in `qualification.json` after committing the implementation.
Linux x64 and Windows x64 remain pending until their hosted jobs execute; the
workflow declaration alone does not qualify an OS. Rust native/Wasm artifacts
remain unsupported. Malformed C# that cannot be parsed is retained as a repro with
explicit unsupported reduction rather than a false minimality claim.

The workflow uses reviewed immutable action pins from the A29 supply policy.
Qualification runs on explicit manual dispatch, serially across platforms.
Ordinary PR/main pushes, labels and schedules do not start the native corpus.
The retained evidence describes the commits in `qualification.json`, including
the corpus at `76eb0bfafae911c24eeebab2341b79ea9c9aa963`. Workflow readiness
changes have not run new local tests, builds or native captures. Validation of the
larger integrated scope and reconciliation of known differences remain pending;
merging the runner implementation does not complete cross-platform qualification.
