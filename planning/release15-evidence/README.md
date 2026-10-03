# 0.15 source and requirement inventory

This completes the audit artifact for [SF-R015-T01 / #423](https://github.com/wieslawsoltes/SharpForge/issues/423).
It does not qualify or close the [0.15 delivery tracker](https://github.com/wieslawsoltes/SharpForge/issues/422).

The inspected source is **f750562017aca877b10f74184dd7b19e2228ddda**, on the published T11 release-policy stack.
Its package version is still `0.14.0`. No earlier 0.15 archive, source tree, attachment, URI or verifiable commit was supplied.
This audit does not relabel current code as recovered 0.15 work. Main and product files are unchanged.

[provenance.json](provenance.json) records the exact Git tree, observed remote main, tools and ownership lease.
[refs.tsv](refs.tsv) freezes 77 remote heads/tags observed on 2026-10-03; it is an inventory of refs, not an assertion that
all branches were merged or behaviorally reviewed. Findings below apply only to the pinned inspected commit.
[source-files.json](source-files.json) records SHA-256, byte count, Git blob and last-changing commit for all 39 referenced
implementation/test files. [changed-paths.tsv](changed-paths.tsv) lists relevant changes since the tracker’s original
CI baseline `7f0ca223d1b9a07725078260020019cfb276c241`; that baseline and its product predecessor are preserved in history.
The frozen [release requirement](issue-422.json) and [audit requirement](issue-423.json) distinguish source facts from later issue edits.

## Findings and existing owners

`Partial` means useful implementation exists but the full requested behavior is incomplete. `Absent` means the requested
integrated capability was not found in this snapshot, even where constituent libraries exist. Every row is **unqualified
at the inspected commit**: no test, build, native, browser or performance execution was run for this audit.

| Requirement | Implementation | Existing owner and concrete remaining work |
|---|---|---|
| Designer chrome | Partial | [#254](https://github.com/wieslawsoltes/SharpForge/issues/254): exact toolbar geometry/theme/density/DPI fixtures; [#1735](https://github.com/wieslawsoltes/SharpForge/issues/1735) separately owns Button-control alignment. Defect screenshot was not supplied. |
| Per-document Design/Split/Code | Partial | [#411](https://github.com/wieslawsoltes/SharpForge/issues/411), [#261](https://github.com/wieslawsoltes/SharpForge/issues/261), [#417](https://github.com/wieslawsoltes/SharpForge/issues/417): independent document sessions, rename/partial-file/reopen lifecycle and round-trip tests. Studio currently attaches one designer source session. |
| Two apps and two instances | Absent | [#262](https://github.com/wieslawsoltes/SharpForge/issues/262), [#267](https://github.com/wieslawsoltes/SharpForge/issues/267), [#181](https://github.com/wieslawsoltes/SharpForge/issues/181): multi-session orchestration, isolated debugging/grants and late-callback disposal. Studio currently has one runtime client/current debug session. |
| Numeric/SIMD/worker performance | Partial | [#424](https://github.com/wieslawsoltes/SharpForge/issues/424), [#155](https://github.com/wieslawsoltes/SharpForge/issues/155): shared fair budgets and new same-runner cold/warm/p95/p99 measurements. Actual SIMD and bounded worker pools exist; per-pool limits are not a cross-app budget. |
| HTTP and managed WebSocket | Partial | [#174](https://github.com/wieslawsoltes/SharpForge/issues/174), [#181](https://github.com/wieslawsoltes/SharpForge/issues/181), [#183](https://github.com/wieslawsoltes/SharpForge/issues/183): managed sockets, per-app revocation/backpressure and credential isolation. JS WebSocket and managed HttpClient are distinct existing components. |
| WinUI-compatible GPU drawing | Partial | [#245](https://github.com/wieslawsoltes/SharpForge/issues/245), [#248](https://github.com/wieslawsoltes/SharpForge/issues/248), [#250](https://github.com/wieslawsoltes/SharpForge/issues/250): device loss, fallback and physical-device qualification. Existing WebGPU simple primitives plus Canvas2D/DOM fallback do not establish full WinUI/Composition or optional Win2D parity. |
| App-only HTML download | Absent | [#359](https://github.com/wieslawsoltes/SharpForge/issues/359), [#361](https://github.com/wieslawsoltes/SharpForge/issues/361), [#368](https://github.com/wieslawsoltes/SharpForge/issues/368), [#425](https://github.com/wieslawsoltes/SharpForge/issues/425): selected-entry closure, runtime-only emitter and concurrent/cancellable downloads. Existing standalone packaging embeds the Studio IDE. |
| Saved-file/HTTP/HTTPS/offline security | Partial | [#364](https://github.com/wieslawsoltes/SharpForge/issues/364), [#365](https://github.com/wieslawsoltes/SharpForge/issues/365), [#369](https://github.com/wieslawsoltes/SharpForge/issues/369): actual app deployment modes and forbidden-state/credential tests. Existing standalone smoke injects the IDE into `about:blank`; it does not test saved-file or served navigation. |
| Real remote Git authentication/workflows | Absent | [#347](https://github.com/wieslawsoltes/SharpForge/issues/347), [#348](https://github.com/wieslawsoltes/SharpForge/issues/348), [#350](https://github.com/wieslawsoltes/SharpForge/issues/350), [#356](https://github.com/wieslawsoltes/SharpForge/issues/356): authorized-provider auth/revoke/cancel, dirty buffers and expected-remote push. Local filesystem capability tokens are not Git authentication. |
| Complete Git → designer → apps → downloads → push chain | Absent | [#426](https://github.com/wieslawsoltes/SharpForge/issues/426): integrated acceptance once the existing product owners deliver prerequisites. No executable acceptance chain exists at this pinned commit. |

[requirements.json](requirements.json) gives every requirement its exact implementation paths, full existing owner IDs/issue
links, runnable existing test command with its actual scope, and concrete missing-acceptance task. These are recovery scopes
for existing owners, not new product implementations. Claim their available atomic children before editing; this audit’s
lease covers only `planning/release15-evidence/**`.

## Retained evidence and limits

[observed-evidence.json](observed-evidence.json) records integrity checks on 22 historical files. Their exact bytes were
inspected against SHA-256/byte counts; no test rerun is implied.

- The existing [T08 record](../qualification/supply/evidence/macos-arm64-2026-10-03/results.json) binds its aggregate
  2,834 passing core tests and supply checks to `b6a47980eaffe24f01f94da36d1e43d836366de9`, on macOS arm64 with Node 24.21.0.
  Its package-smoke record separately identifies `938ef79`; it is not represented as a new run at the audited commit.
  See its retained [core log](../qualification/supply/evidence/macos-arm64-2026-10-03/core.log).
  Aggregate passing tests do not qualify the missing 0.15 capabilities or the current source.
- The actual failed T09 [offline report](historical/t09-offline.json) and [freshness report](historical/t09-freshness.json)
  bind to `b07a931a29dd2fc23a800282a8a6d14bfd11c5cf`. Payload hashes matched, but ten generated examples were stale;
  `passed` remains false. Subsequent example refresh is not a passing rerun. macOS npm offline mode is not Linux kernel
  network-isolation qualification.
- Unpinned historical release-note counts and conversational success claims are not imported as proof. Browser/native
  targets, physical GPU versus fallback, real remote-provider authentication and the complete release chain remain unknown.

## Exact-source reproduction, not newly passing evidence

A real local audit source archive was created from the inspected commit. It is **not** an earlier supplied 0.15 snapshot
or a published release asset; no remote download link is asserted. Its 37,263,360 bytes have SHA-256
`e62d2a1781ae8f1ef58a9cb16d47565bb607c6886e185514403ec969d9c45f13`.
The exact commands used for archive creation and hashing were:

```sh
git archive --format=tar --output=/tmp/SharpForge-release15-audit-f750562.tar f750562017aca877b10f74184dd7b19e2228ddda
shasum -a 256 /tmp/SharpForge-release15-audit-f750562.tar
```

The hash was observed with Git 2.33.0 on macOS 26.6 arm64. The Git commit/tree and file hashes remain the authoritative
source identity if a different Git archive implementation produces different container bytes.

The following is a **future reproduction recipe, not executed here**. Use a new checkout of the pinned source with
Node 24.21.0/npm 11.19.0 and Python 3.14; record actual browser/OS/device versions and all failures independently.

```sh
git worktree add --detach ../SharpForge-release15-reproduce f750562017aca877b10f74184dd7b19e2228ddda
cd ../SharpForge-release15-reproduce
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: -r tests/requirements.txt
.venv/bin/python -m playwright install chromium
npm run build
npm run standalone
node --test tests/designer-sync13.test.js tests/syntax-designer-sync.test.js tests/compute14.test.js tests/network14.test.js tests/runtime14.test.js tests/project-runtime14.test.js tests/winui-runtime.test.js
.venv/bin/python tests/browser_release13_test.py
.venv/bin/python tests/browser_release14_test.py
.venv/bin/python tests/browser_release12_test.py
.venv/bin/python tests/standalone_test.py
```

Leave `SHARPFORGE_IN_MEMORY` unset for the normal served browser suites; the standalone test explicitly remains an
injected-IDE smoke. These commands exercise only the existing baseline scenarios identified in the inventory.
They cannot pass nonexistent app-only, concurrent-app or Git workflows. New product changes belong to the existing owner
issues, and fresh exact-source qualification belongs to their tests and the final #426 acceptance fixture.
