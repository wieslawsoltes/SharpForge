# A29 integration with merged foundations

This integration starts at T08/T09 `1b1a85d1d26f9e13c8d2bbbb8dbe034fa58a97b8`,
retains its `codex/a29-repro` stack base, and merges main
`ff607380dbb14f03d9803c9ef534532f6379b6f2` and T10
`dd50a7d386342df1aa77b93050d1dbe1cc179cf1`. Those merges were conflict-free.
All eleven approved generated T09 outputs, their golden lock and the reviewed
T08/T09 ZIP/EXE origin entries are retained unchanged. New product/runtime work
arrives through the existing main commits, not edits in this integration.

## Existing automatic failure and its fixes

PR3242's [automatic core run](https://github.com/wieslawsoltes/SharpForge/actions/runs/37139616306)
reported 2,870 tests: 2,868 passed and two failed. Native workflow jobs were
correctly skipped for the ordinary PR. Read-only review of that existing log
identified two harness defects:

- The permission fixture's top-level `return 0;` failed compilation before the
  denied output write. It now uses an explicit integer `Main`, as does the host
  measurement fixture, so the intended permission/exit-code assertion is reached.
- Fetch/Undici suppressed the custom malicious Host header. That one probe now
  uses `node:http` to send the exact wire header and retains its required 403
  assertion. The actual loopback server and authorization checks are unchanged.

Static integration review also found that the supply workflow policy rejects
nested matrix expressions interpolated into shell scripts. Native jobs now pass
matrix values through environment variables and quote them in explicit Bash
steps; the strict supply linter is unchanged.

None of these fixes has been rerun locally. The earlier passing tests cannot be
attributed to this new combined revision. Full core/build/native/supply/repro
qualification remains deferred to the integrated epic batch.

## Additive registry and fixture provenance

The shared [native capability registry](../../../planning/contracts/platform-capabilities.json)
adds five capability IDs. Six actual target identities and two exact tool-qualified
engine identities per capability preserve all sixty T10 obligations. The shared
specification registry appends `sharpforge-native-platform-v1`; existing revision
descriptors are unchanged. The rollup engine identity is `<engine>@<exact version>`
and the platform identity is `<os>-<architecture>`, preserving the distinction
between SDK8/10 and Node22/current captures. Every registration is unknown, the
native evidence array and artifact index are empty, and no proof is fabricated.

Main adds 24 source-built DLL fixtures absent from the older supply license
inventory. Read-only source/provenance review identified ten reference-manager
assemblies built from `packages/compiler/test/references/fixtures.js`, thirteen
metadata fixtures built from `tests/fixtures/metadata/src`, and the documented
RuntimeFaults fixture. These are first-party fixture sources; MiniStandard is a
repository-defined metadata library, not a copied framework binary. Their exact
asset hashes and source/provenance pointers are retained in
[main-dll-provenance.json](main-dll-provenance.json). The license inventory appends
only those 24 repository-MIT declarations; existing assets and policy rules are
unchanged. No binary is regenerated or downloaded by this integration.

## Public localhost TLS fixture integration

The sibling browser scope contains an intentionally public localhost TLS key at
`tests/conformance/browser/fixtures/localhost-key.pem`. Its adjacent README at
published commit `73596fc9d3a77c237a5b933ad17987b6e2ec4e81` documents loopback-only
test use without installation in a trust store. The exact file SHA-256 is
`c5ae2593e48821c3ce4dcbeb4d7221f533cc91a94b75575004f276bc976851d3`.

The supply scanner accepts that one reviewed source path, full-file digest and
private-key rule through `public-fixtures.json`, and retains applied exceptions
in its report. Any changed bytes produce a failing digest-mismatch finding.
Other paths, copied build output and token/entropy rules stay active. Boundary
regressions are added but unrun. This prepares the sibling browser merge; it does
not copy or regenerate the key or claim that browser qualification has passed.

Ordinary PR qualification remains one core job. Release producers retain exact
Node 24.21.0/npm 11.19.0, strict dist/payload seals and payload-only publishing
verification. This work performs no release, deployment, new native capture,
local validation or board completion claim.
