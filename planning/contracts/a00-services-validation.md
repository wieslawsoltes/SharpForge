# A00 T02 / T03 validation and handoff

Scope: issues #5, #6 and leaves #1039–#1054. Branch: `codex/a00-services`. All implementation was completed before scope-level validation; subsequent checks cover fixes and integration.

## Source revisions

- Audited product baseline: `011f2bc3bdd84f8db82a928d117100017211ca78`.
- Initial worktree base, including the original CI fix: `7f0ca223d1b9a07725078260020019cfb276c241`.
- Registry/Studio extraction after rebasing onto the planning/CI stack: `c7b2452`.
- Final product source, including the released-order check and storage key constants: `60609b9cf98f4b0ea6563f91b77c249aae4515ca`.
- Stronger dispatch qualification with verified callback fixtures: `c56c82d9a52319700a35fc2d487fe863a011fa49`.
- Integration base includes planning commits `903505d`, `8b82b35`, and CI commits `68ce26b`, `6bd5db5`. The rebase had no conflicts.

## Environment and commands

macOS 26.6, arm64; Node v24.21.0; Python 3.14.7; Playwright 1.57.0; Chromium 143.0.7499.4. The shell's default Node was v16, so commands explicitly selected the supported Node installation. `python` comes from the existing browser-test virtual environment.

```sh
export PATH=/Users/wieslawsoltes/.nvm/versions/node/v24.21.0/bin:/tmp/sharpforge-a05/venv/bin:$PATH
export TMPDIR=/private/tmp
node scripts/planning/snapshot-contract-ids.js
node scripts/planning/check-contract-implementations.js
node --test --test-concurrency=4 tests/*.test.js
node --test tests/a00-02-registry.test.js tests/a00-03-studio-registries.test.js
npm run build
npm run test:packages
node examples/registries/contributions.mjs
node scripts/planning/benchmark-registries.js
python tests/browser_test.py
python tests/browser_release08_test.py
```

The full final product-source run passed **2,615 / 2,615 tests**, with no skips or failures. The 27 focused tests passed again after the dispatch-fixture improvement. A prior unrestricted-concurrency rerun hit an existing debugger function-evaluation wall-clock timeout while other jobs were active; the failed debugger scope and the bounded-concurrency full suite both subsequently passed. No runtime timeout was relaxed.

The ABI locks match **1,744 framework contracts** and **1,781 builtins** (37 intrinsics plus contracts). Every contract now has source-VM and CIL-VM handler reachability evidence: **1,744 implemented, zero source-only, zero CIL-only, zero missing**. The committed report distinguishes returned values and managed argument exceptions; it does not substitute handler reachability for complete API behavior. Actual source/CIL regression tests remain the correctness gate. New unqualified contracts and loss of a handler in either engine fail the regression check.

Both production worker bundles build. Tests send requests to both real source worker modules, check positive replies, structured unknown-method errors, malformed requests, and termination. Public package verification and the runnable contribution example pass. `studio.js` decreased from 190,682 to 131,500 bytes (**59,182 bytes extracted**). The sorted 109-path automation surface matches the pre-extraction snapshot.

## Browser scope

The complete initial extraction was exercised with the following existing suites, unchanged:

```sh
python tests/browser_managed_test.py
python tests/browser_msbuild_test.py
python tests/browser_native_explorer_test.py
python tests/browser_release05_test.py
python tests/browser_release06_test.py
python tests/browser_release08_test.py
python tests/browser_release09_test.py
python tests/browser_release10_test.py
python tests/browser_release11_test.py
python tests/browser_release12_test.py
python tests/browser_release13_test.py
python tests/browser_release14_test.py
python tests/browser_test.py
python tests/browser_workspace_test.py
node scripts/standalone.js
python tests/standalone_test.py
```

Thirteen of the fourteen browser suites passed on the original worktree base. The explorer suite reproduced the base's macOS Emacs caret-origin failure. After incorporating the CI agent's fix through the planning stack, that suite passed, including the unchanged menu labels/order, every tool context menu, Vim/Emacs, debugger state and document popouts. The main and explorer suites passed again against final product commit `60609b9`. The standalone workflow passed with the extracted modules and both bundled workers. Tests reject browser JavaScript errors.

These runs cover the real browser UI and source/CIL engines; native MSBuild tests use their existing loopback host. The in-memory and standalone harnesses do **not** qualify ordinary navigation or native file-URL persistence. The main suite uses normal HTTP. This local evidence does not claim Windows/Linux OS qualification, native .NET CLR execution, native WinUI/WinRT parity, physical GPU qualification, or OS-thread semantics. Those remain separate platform gates.

## Performance evidence

`a00-services-performance.json` records 25 fresh-process cold imports, 100 warm full framework registrations, 1,000 command dispatches, and V8 sampled allocated bytes for ten registrations. Units are milliseconds. V8 sampling uses a 1,024-byte interval with collected objects included; this is an allocation estimate, not a retained-heap measurement.

Correctness gates remain enabled during measurement. Cold import median/p95/p99: **12.096 / 17.759 / 23.656 ms**. Warm registration: **2.072 / 3.656 / 4.973 ms**. Command dispatch: **0.000208 / 0.000250 / 0.001125 ms**. Sampled allocation total: **35,900,120 bytes for ten registrations**. The released builtin table remains a frozen array on the runtime hot path.

## Integration handoff

No runtime dispatcher files were changed; external A05 work remains isolated. Registry and Studio hot-file ownership was coordinated with the root agent. Product, example, locks, negative/boundary/cancellation/disposal tests, capability inventory, performance measurements and this evidence are committed. No branch push or PR was performed by this subagent; the root agent owns the stacked PR publication and final rebased qualification.
