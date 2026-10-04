# Build and test registration

Tests are owned by the 30 `tests/manifests/Axx.json` files. Their strict schema is
`test-manifest.schema.json`; paths are relative to the repository, timeout is in
milliseconds, and node globs use `*`, `**`, and `?`. Every matched test must have
exactly one owner, even across overlapping globs in the same manifest. Empty
areas use empty arrays. Add a new test to its area's manifest; no root script edit
is needed. Runnable `*.test.js`, `*.test.mjs`, `test_*.py`, and `*_test.py` files
under `tests/` and `planning/contracts/tests/` are discovered recursively. Python
support modules (including `browser_harness.py`) are not executable suites.

`npm test` validates all ownership and runs all registered Node tests in one Node
runner, preserving its aggregate executed test count. `npm test -- --area A20`
selects an area; `--list` emits resolved manifests without running tests. `--browser`
also executes that area's registered Python suites. Browser services are declared
in `requiredServices` for CI provisioning and must be available before execution.
Node test files execute serially (`--test-concurrency=1`), including historical task aliases. Use `--` to forward other Node runner flags; concurrent overrides are rejected. The timeout passed to Node is the largest
selected manifest timeout; an area invocation uses that area's exact timeout.

`node scripts/planning/ci-matrix.js` validates and emits `{ "include": [...] }`
for every nonempty area. `ci-matrix.schema.json` validates the output. The dry-run
workflow fixture in `tests/manifests/fixtures/ci-matrix-workflow.json` is executed
by the registration tests to prove matrix expansion and area selection.

`npm run task -- NAME [arguments]` discovers `scripts/tasks/*.json`. A contribution
contains version 1 and `tasks`, with ordered `steps` that invoke an executable
or another `task`. Node, Python, and npm receive platform-aware resolution;
other tools such as cargo are invoked directly. Arguments stay literal; contributed test globs are expanded
without a shell on every OS. `--list` lists tasks, and `NAME --dry-run` emits a
command plan. New task names need no root package edit. The four stable entry
points are `test`, `build`, `check`, and `task`; old npm script names remain as
fixed dispatcher aliases because npm requires a root script entry for each
`npm run NAME`. `scripts/tasks/compatibility.json` maps every historical alias.
The `check` task runs the manifest checker before syntax checks, making missing
or duplicate ownership fail the existing CI check gate.

`apps/studio/build.contrib.json` and discovered `packages/*/build.contrib.json`
register ordered styles, workers, and static assets. Paths are repository-relative
for sources and dist-relative for targets/worker entries. Equal order values are
resolved by contribution path then source path, preserving deterministic builds.
Assets are copied before module rewriting, styles are concatenated with the
original newline separator by default, and declared worker entries are bundled
afterward. A style entry may set `separator` to the empty string to retain a
contiguous fragment boundary, or explicitly to a newline. Other values fail.
Adding a stylesheet or worker only requires an owner contribution change.

The package verifier derives workspace package identities and exact tarball
counts from root workspace patterns. Each package owns `smoke.mjs`, copied beside
the isolated test runner so every package import resolves the offline installed
tarballs. `smoke({api, directory, report})` checks the public API. Optional ordered
`smokeSteps` share compiled fixtures in the original integration sequence; optional
`smokeInstalledCli` exercises installed command-line entry points. All original
assertions, including ECMA-335 round trips, both VMs, debugger history/EnC,
source synchronization, SIMD worker threads, HTTP transport, LSP/DAP framing,
and MSBuild help, remain in package contributions. Windows invokes npm and
installed JavaScript binaries through Node rather than shell launchers.

The historical issue counts are snapshots of 0.14.0, not constants: registration
reports the current number of files, and Node reports the current executed tests.
Validation evidence is recorded in `a00-build-registration-evidence.json`.
On macOS arm64 with Node 24, all 12 registration tests passed, including a real
26-package offline installation. All 25 production packages passed their public
API checks, 45 integration steps (103 original assertion expressions preserved
verbatim), and installed LSP/DAP/MSBuild checks. The core browser suite and offline
standalone suite passed. CSS and both bundled workers matched the original build
byte for byte. Syntax checks passed for 358 modules.

The complete registered suite ran 2,743 tests: 2,741 passed and two inherited ABI
metadata checks failed (bytecode inventory hash and framework version reexport).
The ABI owner has corrections for stack integration; no checks were disabled.
Windows/Linux and minimum Node 22 remain CI execution targets, not locally
claimed results. Warm discovery medians across 20 iterations were 11.5 ms for
manifests, 2.2 ms for build contributions, 9.7 ms for packages, and 7.8 ms for task
planning. The standalone suite tests about:blank injection; native file URL
storage/persistence was not exercised.
