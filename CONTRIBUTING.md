# Contributing to SharpForge

These rules apply to every contributor, human or agent. They exist so that many people can work on the compiler, runtime, WinUI layer and IDE at the same time without degrading performance, quality or the ability to change the code later.

Work is tracked on the [project boards](https://github.com/wieslawsoltes/SharpForge/issues/1); each board's README explains how to claim an item.

## 1. Architecture

**Package boundaries are the architecture.** Each directory under `packages/` is one unit with one job, and `apps/` only composes packages.

- **Dependencies point one way:** `text` → `syntax` → `compiler` → `bytecode`/`cil` → `runtime`; `framework` and `winui` sit beside the runtime; `language`, `refactoring`, `debugger`, `designer` consume the compiler; `apps/studio` and `apps/cli` consume everything. A lower layer never imports a higher one. No import cycles between packages or between modules inside a package.
- **Import a package only through its entry point** (`@sharpforge/<name>`, i.e. `packages/<name>/src/index.js`). Never reach into another package's `src/` files.
- **Public surface is deliberate.** Anything exported from a package entry point is a contract: document it, test it, and do not change its shape without updating every consumer in the same pull request.
- **Extend through seams, not patches.** Add behaviour by registering with a table, visitor, handler map or contribution interface. Do not monkey-patch prototypes, wrap another module's methods at import time, or add another branch to a central `switch`/`if` chain when a registration point exists. If no seam exists, add one first in its own commit.
- **Separate phases and data from behaviour.** Parsing, binding, lowering and emission are separate stages with explicit data passed between them (syntax tree → bound tree → lowered tree → IR). The same goes for runtime decode vs. execute, and for UI state vs. rendering. One stage does not reach back into an earlier stage's internals.
- **Model concepts as types, not strings.** Types, symbols, opcodes, diagnostics and capabilities are objects or enumerations with one definition, not ad-hoc string comparisons or regular expressions scattered across call sites.
- **No hidden global state.** Sessions, workspaces, heaps, caches and permissions are explicit objects passed to whoever needs them, so that several can exist at once (several apps running, several documents open).
- **Stable identifiers are locked.** Contract ids, opcode numbers, diagnostic ids and serialized formats never change meaning. Add new ones; version formats.
- **Record significant design decisions** in the pull request description: what was chosen, what was rejected and why.

## 2. File and function size

No big code files. A file is a unit a reviewer can hold in their head.

| Limit | Value |
|---|---|
| Source file length | 500 lines |
| Source file size | 40 KB |
| Line length | 160 characters |
| Function length | about 80 lines |
| Function parameters | 5; use an options object beyond that |
| Nesting depth | 4 |

- **One responsibility per file.** Name the file after the one thing it does (`overload-resolution.js`, not `helpers.js` or `misc.js`).
- **When a file approaches a limit, split it** by responsibility before adding more. Group related files in a directory with a small `index.js` that only re-exports.
- **Legacy files are frozen.** 159 existing files exceed the limits (the largest are `apps/studio/studio.js`, `packages/compiler/src/index.js` and `apps/studio/designer-tools.js`). They are listed in `scripts/quality/structure-baseline.json` and may only shrink. Put new code in a new module and call it from the legacy file; when you touch a legacy file for more than a few lines, extract the part you are changing.
- **No new dense or minified-style code.** Much of the original source packs many statements per line. Do not imitate it: one statement per line, formatted and indented, with names that say what things are.
- `npm run check:structure` reports new files over the limits and legacy files that grew. `node scripts/quality/check-structure.js --strict` fails on them; it becomes part of the required check once the open pull request stacks have landed.

## 3. Code quality

- **Readable first.** Descriptive names, no single-letter identifiers outside short loops and lambdas, no abbreviations that are not already domain terms (`IL`, `PE`, `GC`, `IR`).
- **Small, pure functions where possible.** Keep side effects at the edges. A function either computes a value or performs an effect, not both.
- **No duplication of logic.** If the same rule exists in two places (two evaluators, two Math implementations, two session classes), unify them behind one module before extending either.
- **Errors are explicit.** Never swallow an exception. User-facing failures are diagnostics with a stable id, span and severity; internal invariants use assertions that name the invariant. Unsupported constructs produce a clear diagnostic, never a silent miscompile or a wrong result.
- **Warnings are not failures**, and errors are never downgraded to make a test pass.
- **Bounded and deterministic.** Anything driven by untrusted input (source, assemblies, archives, network data) has explicit size, depth and time limits. No dependence on wall-clock time, iteration order of unordered collections, or random seeds in compiler or runtime output.
- **Comments explain why**, not what. Public functions get a short doc comment stating contract, units and error behaviour. Remove dead code rather than commenting it out; no `TODO` without an issue number.
- **No new dependencies** without prior agreement in the tracking issue. The product is dependency-free at runtime by design.
- **Security:** no `eval`, `new Function` or dynamic script injection; the application must run under the shipped Content-Security-Policy. Never log or persist secrets or tokens. Network access goes through the explicit origin-grant model.
- **Accessibility:** UI changes keep keyboard operability, visible focus, labels and sufficient contrast in light and dark themes.

## 4. Performance

Performance is a requirement, not a later optimisation pass.

- **Know your hot paths:** the lexer and parser, binder lookups, the interpreter dispatch loops, the scheduler, GC mark and sweep, layout and rendering, and editor keystroke handling.
- **On hot paths:** no allocation per token, instruction, object visited or frame unless unavoidable; no closures created in loops; no `Map`/array rebuilt per call; no regular expressions or string concatenation per instruction; no repeated property-chain lookups that can be hoisted; prefer typed arrays and preallocated buffers; keep object shapes stable.
- **Algorithmic complexity is stated and tested.** Nothing quadratic in source size, member count, heap size or item count. Collections that are searched are indexed.
- **Do work once.** Cache derived data with explicit invalidation; make repeated work incremental (reparse, rebind, relayout, redraw only what changed).
- **Measure before and after.** Any change touching a hot path includes numbers in the pull request: the benchmark command, machine, median and p95 before and after, and allocations where relevant. Use the existing benchmark scripts (`npm run bench`, `bench:il`, `bench:runtime`, `bench:compute`) or add one next to the code.
- **Regression budget:** more than 5% slower on an existing benchmark, or more than 10% larger build output, needs an explicit justification and sign-off in the pull request. A correctness fix may cost performance; say so and quantify it.
- **Startup and size count.** Lazy-load what is not needed for first paint or first run; do not add work to module top level.
- **UI stays responsive:** no synchronous work over about 16 ms on the main thread; long work goes to a worker or is chunked and cancellable.
- **Do not report speedups you did not measure**, and report the actual backend used (WebGPU vs. fallback, SIMD vs. scalar, worker vs. inline).

## 5. Testing

- **Every change comes with tests** in a new, focused file `tests/<area>-<topic>.test.js`. Do not append to the large per-release test files.
- Cover the positive case, the negative case (diagnostics, rejected input), boundaries, and cancellation or disposal where it applies.
- **Compare against a reference** when one exists: Roslyn syntax trees and diagnostics, real CLR results, Portable PDB readers, WinUI metadata. Record the reference tool version.
- **Run on every engine affected** (source VM, direct CIL, and Rust native/Wasm when present). State unsupported targets explicitly; never report them as passing.
- **A bug fix starts with a failing test** that reproduces the bug.
- Tests are deterministic, need no network, and do not write into tracked files.
- Do not weaken or delete an existing assertion to make a change pass. If an assertion encoded a defect, say so in the pull request and replace it with the correct one.

## 6. Working approach: ship complete batches fast

The backlog is large and many agents work at once. Throughput comes from landing complete, honest increments quickly, not from holding work back until everything around it is perfect.

- **Work in complete feature batches.** A batch is one feature (or a few closely related sub-tasks) taken end to end: implementation, diagnostics, focused tests and a truthful description. Do not publish half a feature, and do not grow a batch into an epic-sized branch.
- **Reuse what exists before building anything new.** Look for an existing API, seam or helper in the owning package and use it — for example, async lowering targets the runtime's existing continuation API instead of inventing a second mechanism. A new abstraction needs a reason the existing one cannot serve, stated in the pull request.
- **Publish promptly.** Open the pull request as soon as the batch is implementation-ready. Unpublished work is invisible to other agents and goes stale.
- **State limits explicitly.** Where support is incomplete, say exactly what is and is not covered: in the pull request description, in a diagnostic for the unsupported case (never a silent wrong result), and by leaving the issue open or listing the remaining sub-tasks. An honest "partial" is always better than a claimed "done".
- **Merge implementation-ready work without waiting for broader qualification.** A pull request merges when its own required check passes. Do not hold it for the full browser, native or cross-platform matrix, for other workstreams' follow-ups, or for review of unrelated work.
- **Stage heavy validation.** Run the full matrix (`full-ci` label) once per completed epic or larger scope, then fix what it finds in follow-up batches.
- **Do not refresh branches every time `main` moves.** Merge `main` into your branch only when you need to: there is a conflict, a required check fails because the branch is behind, or you depend on something that just landed. Constant refreshing burns CI time and creates churn for anyone stacked on you.
- **Spend integration effort where it lands work.** When several batches are ready, the priority is getting them merged — resolving their conflicts and stack order — over starting new work.
- **Keep `main` green.** If `main` is red because of your area, fixing it comes before anything else. Never merge a pull request whose required check failed because of your change.
- **Do not wait.** Move straight to the next batch after publishing; do not block on review, on other agents, or on answers you can find in the code. Record a real blocker on the owning issue and take another item meanwhile.

## 7. Pull requests

- **Small pull requests: one batch each**, roughly up to 15 files or 800 changed lines; one sub-task per commit. Commit message: `<WORK-ID>: <what changed>` (for example `SF-A02-T19: classify implicit numeric conversions`).
- **Base on `main`.** Stack on another unmerged branch only when the work truly depends on it; then base the pull request on that branch, merge (never rebase or force-push) to pick up changes below you, and state the stack order in the description.
- **Merge with a merge commit**, never squash or rebase, because other work may be stacked on yours. On "base branch was modified", retry; on a conflict, merge `main`, resolve keeping both sides' intent, push and retry.
- **Stay inside your workstream's files.** If you need a change in another workstream, ask on the owning issue; if a small change is unavoidable, make it minimal and list it under "Changes outside this workstream".
- **Description states the truth:** what is done (with `Closes #n` only when the acceptance criteria are fully met and tested), what is partial or not done and why, how it was verified, what was reused, performance numbers when relevant, what is needed from other workstreams, and anything a reviewer would be surprised by.
- **Checks:** a pull request runs one fast required check, `core` (static/manifests, contract/seam review, quarantine expiry, build and checkout integrity). Main pushes also run only core. Node tests and central browser, native and cross-platform qualification are staged for explicit dispatch, merge groups, release calls, and pull requests labelled `full-ci`; specialized workflows are dispatched separately. Follow the [serial validation schedule](planning/qualification/serial-validation.md).
- **At the scheduled validation slot,** run new and changed test files through `node scripts/limited.js` (see section 8), plus the applicable checks for the completed scope. Record pending validation explicitly when publishing drafts. The ordinary pull request check does not execute the full unit suite.
- **Tests are portable.** Build paths with `fileURLToPath`, never `new URL(...).pathname`; normalize path separators before comparing names; do not assume case-sensitive paths or LF line endings.

## 8. Resource limits

Many agents and people build and test on the same machine. One unbounded `node --test` run starts a process per core at 300–500 MB each; a few of those at once push the machine into swap and slow everyone down.

- **`npm test` runs test files serially,** everywhere. Outside CI it also waits for one of a small number of machine-wide run slots and caps the V8 heap of each Node process. `node scripts/limited.js <command>` applies the same local limits to targeted runs, with a small bounded parallelism. Defaults scale with RAM (one run slot and one parallel test file per 8 GB, at most 4; 2 GB heap per process).
- **Run targeted tests through the wrapper:** `node scripts/limited.js node --test tests/<your-file>.test.js`. Do not call `node --test` on many files directly, and never pass `--test-concurrency=0` or a high value.
- **Do not run the full suite locally for every batch.** Full qualification is staged for completed epics or larger scopes. Run it locally only for scheduled qualification or to reproduce a failure, and one run at a time.
- **One heavy job at a time per agent.** Do not start a build, a test run and a benchmark in parallel, and do not have helper agents run tests concurrently in the same checkout.
- **Clean up.** Stop servers, watchers, browsers and background shells you started; do not leave processes running after a batch.
- **Benchmarks need a quiet machine.** Run them alone, and say in the pull request if the machine was shared.
- **Overrides,** when you know the machine can take it: `SHARPFORGE_TEST_CONCURRENCY`, `SHARPFORGE_MAX_PARALLEL_RUNS`, `SHARPFORGE_MAX_OLD_SPACE_MB`. CI sets `CI=true`, which disables the slot and heap limits.

## 9. Review checklist

A reviewer (or the author, before asking for review) confirms:

- [ ] Dependencies point the right way; no cross-package deep imports; no new global state.
- [ ] New behaviour is added through a seam, not a patch to a central file.
- [ ] No new file over the size limits; no legacy file grew.
- [ ] Code is formatted, named clearly and free of duplication.
- [ ] Unsupported or invalid input produces a diagnostic, not a wrong result.
- [ ] Hot paths are allocation-aware and measured; numbers are in the description.
- [ ] Tests cover positive, negative and boundary cases, against a reference where one exists.
- [ ] Existing APIs and seams were reused; any new abstraction is justified.
- [ ] Limits and unsupported cases are stated and produce diagnostics.
- [ ] Every claim in the description is backed by a test or a measurement.
