# T08/T09 release qualification integration

This combines T09 at `971c3e2f72bf4c26b4c06495d3a4d272070a6a2c`
with T08 at `c7a04e0ab37512a0246f1e727171dbb587256da8`.
The stacked parent is `codex/a29-repro`; the supply branch is merged intact.
No release is published or deployed by this integration.

## Release contract

The reusable CI browser and package producers use Node 24.21.0 and explicitly
check the reviewed Node/npm pair using T09's `assertToolchain`. The reviewed
versions are Node 24.21.0 and npm 11.19.0. Ordinary pull requests retain the same
single core check/test/build job and its existing Node version. Producer jobs
remain limited to full qualification; no full-ci label is added by this change.

Release assembly verifies the original producer seals before packaging.
`scripts/conformance/repro/package-release.js` replaces the temporary Python
archive implementation in release and security workflows. It reads the qualified
dist tree and uses the source commit epoch, sorted portable entries and fixed UTC
ZIP fields. It does not rebuild any qualified payload.

The producer generates SOURCE-MANIFEST version 2 and calls `--verify`, requiring
the exact dist tree and artifact payload set. The artifact-only publisher calls
`--verify-payloads`, which requires the exact payload set and SHA256SUMS without
claiming an absent dist tree was checked. Both stages retain real GitHub signature
verification before publication. The exported payload verifier remains compatible
with the attestation service, whose subjects include the complete source manifest,
checksums and SBOM. There is no implicit fallback from strict verification.

The old archive test now invokes the actual deterministic Node packager, preserving
empty-input rejection, exact extracted payload content and the 64 MiB file bound.
New regressions cover the complete producer/publisher CLI boundary, changed/missing
payloads and checksums, strict rejection of missing/changed dist, exact attestation
subject continuity, workflow ordering and the qualified toolchain.

## Reviewed asset reconciliation

The two designer ZIP records now bind the bytes and immutable source origins from
T09's [reviewed generator refresh](../repro/generated-example-refresh.md):
`examples/designer/CanvasCounter.zip` and `examples/designer/GridWorkspace.zip`.
This changes neither their MIT declaration nor their retained repository notice.

Integration also exposed an omitted asset extension in the original supply gate:
managed `.exe` files were not required to declare an origin. The classifier now
requires executable declarations. The exact five existing first-party generated
images are individually recorded against commit `971c3e2`: Finally, Hello,
PrimitiveAddresses, StorageWrites and UsingResources under `examples/managed/`.
Their source and generator remain repository MIT; these declarations do not invent
a third-party download origin. Unknown future executables fail the existing
unlisted-asset gate. No allowlist is regenerated indiscriminately.

No product source, generated example payload, vendor distribution or golden lock
is changed by this integration beyond what already exists in the two parents.

## Evidence and remaining work

No tests, build, workflow execution or performance capture has been run at this
combined revision. Validation is intentionally deferred to the larger epic batch
under the user's 2026-10-03 direction. New tests are implemented, not reported as
passing. The following evidence describes only its original source revisions:

- T08's [retained evidence](evidence/macos-arm64-2026-10-03/results.json) records
  macOS arm64 Node 24.21.0/Python 3.14.7, 2,834 core tests, 12 Node supply tests,
  eight Python tooling tests, actual build/seals/schema validation and source/built
  secret scans at `b6a4798`. All 25 package smokes passed at `938ef79`; the original
  evidence identifies that different revision explicitly.
- T09's [validation record](../repro/validation.md) records 2,841 core tests at
  `4c06dc9`, actual byte-identical double builds for 877 outputs and 134 compiler
  golden examples at `b07a931`, and 24 focused tests before its final commit.
  Its historical offline capture correctly failed stale example freshness even
  though payload hashes matched. The subsequent refresh is not a new passing run.

Final committed core/build/package checks, the combined supply and reproducibility
batch, refreshed example freshness, independent Linux/Windows/macOS qualification,
cross-runner aggregation and Linux network isolation remain to be run. Hosted
CodeQL, successful OIDC signing and real positive `gh attestation verify` remain
unqualified. An exact published-tag rebuild needs an authorized qualifying release;
neither this integration nor the local fixtures create one.
