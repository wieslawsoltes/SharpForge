# Project 16 Windows and macOS browser qualification

Windows/Firefox attempt **w1 passed all nine selected browser scopes**. macOS/WebKit attempt **m1 passed eight of nine**;
its standalone workflow failed during the initial `file://` navigation. The failed m1 run is retained with its trace,
screenshot and exact error. Pinned upstream source strongly explains the failure as a WebKit automation offline-mode
limitation. This record makes no blanket platform acceptance claim.

Both attempts ran the same published source commit `25ef23b0fb86eb3be4151492c2ef6bbc51f0a82e`, tree
`a0922a5f98e4ce38cd377d109a083a1da77df9a1`. The records support **SF-A19-T12.2 / #1583** and the exercised A19/A20
browser behavior. They do not close issues. The [machine-readable ledger](project16-cross-platform-browser.json)
keeps each attempt's identities, scope outcomes, environment, command and evidence paths separate.

## Actual runs and environments

| Attempt | Actual environment | Browser supplied by Playwright | Result |
|---|---|---|---|
| w1 | Windows Server 2025 Datacenter, 10.0.26100, x64 | Firefox 155.0, build 1543 | 9 passed / 0 failed |
| m1 | macOS 26.6.2, build 25G83, arm64 | WebKit 26.6, build 2359 | 8 passed / 1 failed |

Both used Playwright 1.63.0 and CPython 3.12.10. Windows used Node 24.21.0 and runner image
`windows-2025-vs2026` version `20260925.250.1`; macOS used Node 24.20.0 and image `macos-26-arm64`
version `20260907.0351.1`. These versions come from the preserved [Windows job log](evidence/project16-hosted/w1/job.log),
[macOS job log](evidence/project16-hosted/m1/job.log) and per-suite session records.

| Attempt | Workflow run / job | Workflow created → last updated (UTC) | Browser scope execution (UTC) |
|---|---|---|---|
| w1 | [37184606471 / 111383814564][w1-job] | 07:02:40 → 07:07:07 | 07:03:59.353 → 07:07:01.284 |
| m1 | [37184861392 / 111384572220][m1-job] | 07:07:56 → 07:09:44 | 07:08:37.210 → 07:09:38.068 |

All timestamps are on **2026-10-04**. They describe these executions and are not performance comparisons.
The workflow and `qualify` job concluded `success` for w1 and `failure` for m1. Setup and the application build
succeeded in both; the m1 selected-scope step failed and evidence upload succeeded.

## Nine independent browser outcomes

| Selected scope | Windows / Firefox w1 | macOS / WebKit m1 |
|---|---|---|
| Workbench docking | Passed | Passed |
| Workbench shell | Passed | Passed |
| Multiple application sessions | Passed | Passed |
| Lazy tool windows | Passed | Passed |
| Core workflows through HTTP | Passed | Passed |
| Core workflows through standalone `file://` | Passed | **Failed before workflow checks** |
| Editor insights | Passed | Passed |
| Editor language providers | Passed | Passed |
| Editor view | Passed | Passed |

The [w1 qualification summary](evidence/project16-hosted/w1/qualification-summary.json) and
[m1 qualification summary](evidence/project16-hosted/m1/qualification-summary.json) preserve each command, exit code
and start/end time. The three editor scopes ran successfully after the m1 standalone failure; the runner still
returned a failing overall exit code. Scope counts are not individual assertion counts.

The successful workflows cover project creation with an invalid-name rejection, editing and building the shared
document, breakpoint/step/continue debugging, designer edit/undo/redo/save, and export. The
[Windows standalone result](evidence/project16-hosted/w1/vs-workflow-standalone-results.json) additionally records
opening and reopening the assembly, disassembly, MSBuild, project wizard and designer tools. Its real file URL ran
offline and reported no HTTP attempts, page errors or CSP violations. Its build artifact was **16,419,776 bytes**,
SHA256 `da60ffe742f3b723d4b1286fc279c6510067570a7cc54b6550d68e2fcfb855a9`.

The m1 navigation record identifies the same standalone artifact bytes and hash. It records no successful workflow
checks. This identity agreement is useful evidence; it does not establish why WebKit rejected the navigation.

## Retained macOS standalone failure

The exact [m1 standalone result](evidence/project16-hosted/m1/vs-workflow-standalone-results.json) contains:

```text
Page.goto: WebKit encountered an internal error
Call log:
  - navigating to "file:///Users/runner/work/SharpForge/SharpForge/artifacts/SharpForge-standalone.html", waiting until "domcontentloaded"
```

The wrapper returned exit code 1 with `timedOut: false`. The workflow's `checks` array is empty, so creation, editing,
debugging and design are not credited for this standalone attempt. Empty HTTP-attempt, page-error and CSP-violation
arrays describe the captured failure; they do not certify that the application initialized.

The [console log](evidence/project16-hosted/m1/browser_vs_workflows_standalone_test/console.log),
[original trace](evidence/project16-hosted/m1/browser_vs_workflows_standalone_test/trace.zip) and
[screenshot](evidence/project16-hosted/m1/browser_vs_workflows_standalone_test/screenshot.png) are preserved unchanged.

### Source-based explanation of the automation limitation

The [exact SharpForge driver][file-driver] creates the standalone page with Playwright `offline=True` before
navigation. Playwright 1.63.0's [WebKit configuration][webkit-config] pins upstream revision
`4d05d732e5a84f32675bef4cc135a2e7a9269a87`. Its [loader patch][webkit-patch] inserts an offline-emulation guard
that schedules an internal load failure and returns before request interception. The [base loader][webkit-loader]
has earlier archive/data/QuickLook/resource exceptions but no `file:` exemption at that point. The
[failure callback][webkit-failure] delivers `internalError(url)`.

This ordering strongly explains the observed file-navigation error before application checks. Removing the harness's
HTTP-only interception would not bypass the earlier offline guard. This is a source-based explanation of the pinned
automation configuration; no additional isolated browser probe was performed. It does not establish a SharpForge
product defect or native Safari behavior. **The m1 standalone scope and overall run remain failed.** Another engine
or a later upstream fix needs its own exact-source evidence and cannot waive this WebKit result.

## Command and qualification boundaries

Each explicit create trigger selected `browser`, with `captureOnly: true`, `baselineProfile: null` and both baseline
paths null. The hosted Bash step invoked:

```sh
node scripts/project16-qualification.js "$QUALIFICATION_STAGE"
```

`QUALIFICATION_STAGE=browser`; the engine was `firefox` for w1 and `webkit` for m1. Each selected suite ran serially
as `python tests/conformance/browser/run_suite.py <suite> --timeout 1200`, under the existing 1,320,000 ms outer
deadline. These attempts selected no Node-area or performance phase. Capture-only metadata does not imply a
performance capture or a regression verdict when the selected stage is browser.

The separate [a6 Linux/Chromium record](project16-hosted-a6.md) reports nine browser scopes passed on the same source
with Chromium 153.0.8010.12. Its overall run failed at the editor undo p95 relative regression gate; that result is
retained in its own ledger. These are **three selected OS/engine combinations**, not a three-by-three matrix.
No a6 Node, browser or performance totals are added to the w1/m1 counts above.

Playwright WebKit is not real Safari certification. Browser keyboard, DOM, ARIA, synthetic composition, contrast and
media-emulation checks do not certify OS clipboard permissions, native IME, screen-reader speech or spoken output.
The editor view records explicitly retain `nativeImeCertified: false` and `screenReaderCertified: false`.
These browser results also do not qualify native CLR, Rust/native, Wasm, GPU or operating-system integrations.
The successful workflow's `ECMA-335` artifact-format label does not provide a native runtime certification.

Later fixes or qualification attempts must retain their own source identities and outcomes. They cannot turn this
m1 failure into a pass or qualify every platform for a newer source revision.

## Byte-exact archive

| Attempt | Original artifact ZIP | Extracted members | Preserved raw files including ZIP, log and API snapshots | Raw bytes |
|---|---:|---:|---:|---:|
| w1 | 15,322 bytes | 36 files / 23,644 bytes | 41 | 136,438 |
| m1 | 37,289 bytes | 38 files / 72,079 bytes | 43 | 200,889 |

The original ZIP digests are:

- w1: `b79f4c7f36d8771896d6e35415718ba4f8511335a050c3323587f9a2c8804f2d`
- m1: `420c7388efaeb54e1079d53b7434171311b67c6b0947fbdac61346781ab4c92d`

The [w1 manifest](evidence/project16-hosted/w1/manifest.json) and
[m1 manifest](evidence/project16-hosted/m1/manifest.json) list source paths, byte counts and SHA256 for all **84 raw
files / 337,327 bytes**. This is an archive-size total, not a combined qualification count. Every ZIP member was
compared with the extracted original, every copy was read back, and all bytes—including line endings, encoding,
empty console logs, the nested trace ZIP and screenshot—were retained. Supplied connector API snapshots were
copied verbatim; omitted fields in a connector response were not reconstructed.

Archive-scoped Git attributes disable text normalization. All 84 staged raw Git blobs were also compared against
their original byte counts and SHA256 values, preserving the Windows CRLF records in the committed evidence.

Only file reads, archive inspection, byte comparisons and hashing were used to assemble this documentation.
No test, build, browser, benchmark or workflow was executed for the archive. Earlier ledgers remain unchanged.

[w1-job]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37184606471/job/111383814564
[m1-job]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37184861392/job/111384572220
[file-driver]: https://github.com/wieslawsoltes/SharpForge/blob/25ef23b0fb86eb3be4151492c2ef6bbc51f0a82e/tests/browser_vs_workflows_test.py#L126
[webkit-config]: https://github.com/microsoft/playwright/blob/v1.63.0/browser_patches/webkit/UPSTREAM_CONFIG.sh#L1-L3
[webkit-patch]: https://github.com/microsoft/playwright/blob/v1.63.0/browser_patches/webkit/patches/bootstrap.diff#L18234-L18268
[webkit-loader]: https://github.com/WebKit/WebKit/blob/4d05d732e5a84f32675bef4cc135a2e7a9269a87/Source/WebKit/WebProcess/Network/WebLoaderStrategy.cpp#L213-L307
[webkit-failure]: https://github.com/WebKit/WebKit/blob/4d05d732e5a84f32675bef4cc135a2e7a9269a87/Source/WebKit/WebProcess/Network/WebLoaderStrategy.cpp#L672-L681
