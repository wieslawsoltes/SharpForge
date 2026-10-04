# A05 static import gate review

This change repairs the three A05 import findings from the core check after main
`19755847…` integration. It does not change the scanner, package export maps,
dynamic-code rules or structure baseline.

`tests/fixtures/a05-memory/replay.mjs` already constructs `CilVirtualMachine`
through `@sharpforge/runtime`. Its additional pin helper used a relative path
that escaped the repository and reached into a private runtime module. The
replay now checks the existing heap strong-handle statistic through that public
VM. Each scoped fixed pin owns a strong handle, and this fixture creates no
unrelated retained host handles. Requiring zero after termination also detects
an orphaned pin handle that a scan of remaining frames could miss. No runtime
API was added and no guest result assertion was removed.

The single dynamic import in
`tests/a05-profiler-reference-dependencies.test.js` is intentional. The Node test
creates a private temporary directory, copies the checked-out runtime, applies
the existing fail-closed profiler reference transformation, and imports only
that copy's fixed `src/index.js` package entry. It verifies that the reference
constructors have a distinct identity from the ordinary product import and that
shared public dependencies preserve their checked provenance. A static product
import would defeat the behavior under test. Managed program data, filenames
from managed inputs, network content and user-selected module paths do not enter
this import expression.

The reviewed policy is `scripts/conformance/static/allowlist.json`, schema 1.
Its entry binds that exact file to one `dynamic-import` operation and SHA-256
`df5fdca0bcf747df9b90c463145cf9995174a2fd324d11b02baacfea9e2aa263`.
`checkDynamicUses` checks full source bytes and operation count, rejects duplicate
entries and fails on changed or stale entries. This authorizes no other file or
later edit to the test.

The old `scripts/validate-a05-type-system.js` allowance is removed because the
paired runner change `85b8d7b04` replaces both fixed dynamic imports with static
imports. Apply that runner change with this policy update. The two planning
qualification allowances are preserved: their files may be absent from a sparse
checkout, which does not invalidate their reviewed full-checkout entries.

The reference fixture's hash and one-operation count were checked with the
existing scanner. Replay syntax and patch whitespace were checked. These are
static checks, not a new runtime, benchmark or native qualification claim.

## Shared CI Python environment

Outside the A05 runtime files, `.github/workflows/ci.yml` now installs the existing
hash-locked `tests/requirements.txt` immediately before its two infrastructure
unittest invocations. The command and flags are identical to the existing browser
job's package installation. The Ubuntu core step retains the exact full-qualification
condition used by Python setup and the test step; the Windows/macOS job already
has that condition at job level. Ordinary core checks gain no dependency install.

This supplies the already declared Playwright package without adding a dependency,
version or browser binary installation. `tests/browser_harness.py` uses Playwright's
`Page` class at runtime to install its existing CSP-safe wait implementation; it is
not an annotation-only import. Its lifecycle and behavior are unchanged. Actual CI
must still establish that the declared environment installs and the regressions pass.
