# E01 browser qualification

This independent harness compiles source inside a real browser classic worker,
using the same static bundler and runtime modules as the shipped application.
Each source fixture runs in the source VM, assembly-reloaded source VM and direct
CIL VM. It does not replace the Studio UI or native .NET qualification gates.

Run only after the complete E01 scope is assembled:

```sh
node scripts/prepare-a05-browser.js --output artifacts/a05-e01-browser
python tests/browser_e01_test.py --artifacts artifacts/a05-e01-browser
```

Use the existing Python environment containing Playwright. `CHROMIUM_EXECUTABLE`
can select an installed Chromium binary. The default uses Playwright's installed
Chromium; `--browser firefox` or `--browser webkit` selects another installed
browser. No npm dependency installation is required. The Python harness serves
only its generated artifact directory on an ephemeral loopback port.

Preparation rebuilds `dist`, bundles the harness worker and writes exact fixture
inputs. The browser runner rejects a changed commit, tracked diff, suite, or
bundle after preparation. Reports include the commit, dirty worktree status,
bundle and fixture hashes, Python/Playwright/browser versions, every individual
check, full errors and partial results on failure. A dirty tree is reported as
such; its bundle hash identifies the actual tested code.

Coverage includes signed/unsigned and Decimal arithmetic, IEEE edge cases,
native integer widths 32 and 64, await snapshot replay through collection and
cancellation, Monitor recursion/wait/pulse, lock cleanup, Interlocked/Volatile,
and independently assembled rectangular-array CIL with lower bounds and an
interior address surviving GC. Native integer configurations are emulated VM
ABIs, not proof of two native host architectures.

The preemption checks cover zero and one-unit budgets, another logical context
making progress during sorting, parked continuation roots/snapshots, cancellation,
and one million descending integers. Input allocation and population occur before
timing. Every `runSlice({instructionBudget:15000,timeBudgetMs:8})` duration is
recorded, including the first slice; any duration above 16ms fails. No warm-up
samples or outliers are discarded, and raw durations plus instruction deltas
remain in a failing report. Host scheduling and browser GC can therefore cause a
real latency failure rather than being hidden by the harness.

Additional Roslyn DLLs, including the native async/delegate fixtures, can be
included with their oracle output files:

```sh
node scripts/prepare-a05-browser.js --output artifacts/a05-e01-browser \
  --native-int-bits 64 \
  --assembly artifacts/a05-native-async/Async.dll artifacts/a05-native-async/expected.txt \
  --assembly artifacts/a05-native-arrays/Arrays.dll artifacts/a05-native-arrays/expected.txt
python tests/browser_e01_test.py --artifacts artifacts/a05-e01-browser
```

Each supplied DLL is hashed and run directly in browser CIL, with exact output
comparison. Those inputs are explicitly labeled supplied assemblies; this script
does not itself run .NET and does not claim native qualification. Keep the native
runner's evidence alongside the browser report. Tiered execution remains a later
epic and is not represented as a successful browser check here.

The harness is prepared but has not been run during E01 assembly.
