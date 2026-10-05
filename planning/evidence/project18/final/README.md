# Project18 implementation and qualification review

**The complete canonical code tree is published; source and raw evidence artifacts were verified from GitHub.** This report
describes source `0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760`, tree
`7399d972ea939b8a5f05f894bc793f9b713cfd49`, composed with pinned main
[`1db2e1d540a78403b7aaddcf472311fcde1a81ef`](https://github.com/wieslawsoltes/SharpForge/commit/1db2e1d540a78403b7aaddcf472311fcde1a81ef).
The complete final timer scope passed **34/34** Node26 cases, followed by check,
build and clean-checkout. The actual committed Studio Release13 suite then passed
**16/16 checks with no page errors**. Its final change was confined to the browser
fixture; the proven product build at `7d4c97d2` was reused. Remaining storage,
platform, performance and protected-integration gates are recorded separately. [Source record](source.json)

The final canonical metadata commit is `c68c77252cd5469c5aaf0c8318ee28fe2ec3b65d`,
with tree `55e5f5c443d15030bc47592e6ba511862812f363`. Its 122 changes after the
qualified browser source are evidence-only; product and test bytes remain frozen.

The implementation inventory covers all **157 leaf work items**, through
**166 implementation records**; **nine leaves have overlapping contributions**.
The board also contains eight epic trackers and 24 parent tasks, for 189 issue
identities. These are coverage counts, not counts of merged or accepted features.
Each leaf retains its own evidence, support boundary and remaining acceptance
clauses. Epic and parent trackers are not counted again as delivered capabilities.
[Coverage map](coverage.json)

The coverage and publication JSON files are preserved snapshots from the sealed
source review. Their older pending-publication clauses and historical benchmark
notes remain unchanged. Current delivery state is in [source.json](source.json)
and [the aggregate receipt](aggregate.json); the latest matched e9-versus-1db
measurement is in [performance.json](performance.json).

## What is implemented

The following sections describe implemented modules and their named evidence.
They do not imply that every platform, framework, browser or protected application
entry has passed acceptance. The final coverage map links each statement to the
owning source paths, fixtures and publication records.

### A23 E01: Native build and evaluation

The native host has queued operations, trust decisions, bounded process output,
environment and path controls, cancellation, SDK selection and authenticated
transport. Design-time evaluation produces separate project contexts with target
framework/runtime selection, compiler options, generated sources, references and
diagnostics. Build services support solution mapping, dependency graphs,
incremental decisions and structured diagnostic/binlog inspection. Actual Linux
SDK fixtures exercised host execution and metadata consumption; Windows
`msbuild.exe`, other OS cells and historical SDK/node-reuse limitations remain
separately recorded. [Epic #315](https://github.com/wieslawsoltes/SharpForge/issues/315)
and [coverage](coverage.json)

### A23 E02: Design-time and package workflows

Package services cover NuGet configuration and version rules, assets and lock
files, central package versions, package edits and archive asset selection.
Source-preserving project edits retain XML syntax and detect external-write
conflicts. Solution readers/writers handle `.slnx` and classic `.sln`
configuration mappings, including preserved unsupported projects. Native testing
services provide discovery/run requests, filters, TRX, source mapping, progress,
cancellation/debug handoff and coverage parsing. A differential harness and
machine-readable boundary make portable/native differences reviewable. Actual
native xUnit/NUnit/MSTest package acceptance is still unavailable after the one
bounded restore attempt; service and parser tests are not substituted for it.
[Epic #316](https://github.com/wieslawsoltes/SharpForge/issues/316) and
[coverage](coverage.json)

### A23 E03: Portable MSBuild evaluator parity

The evaluator has explicit expression scanning, supported property functions,
arbitrary item types, transforms/metadata, reserved/environment properties, SDK
defaults/resolvers, import ordering, generated sources and compiler options.
Portable target planning/execution, resource/output models, launch/publish
profiles and indexed workspace paths are composed through public contracts.
Projects emit separate assemblies. The supplied SharpForge PE dependency profile
preserves assembly identities, constructors, members, initialization and source
provenance across source and direct-CIL execution. Unsupported tasks, SDKs,
references and CLR features remain explicit diagnostics/boundaries; this is not
arbitrary MSBuild or external-assembly parity.
[Epic #562](https://github.com/wieslawsoltes/SharpForge/issues/562) and
[coverage](coverage.json)

### A23 E04: Portable test discovery and execution

A shared adapter/test-tree protocol supports source discovery for xUnit, NUnit
and MSTest and execution through isolated managed invocation sessions. Portable
Test Explorer input carries the selected project sources, compiler options and
references. The managed fixtures exercise both source and direct-CIL engines,
including intentionally failing and skipped tests, lifecycle behavior and
isolation. Their expected failure/skip outcomes are preserved; they are not
reported as native framework parity or as support for arbitrary framework APIs.
[Epic #563](https://github.com/wieslawsoltes/SharpForge/issues/563) and
[coverage](coverage.json)

### A24 E01: Workspace integrity

Workspace transactions, undo/redo, content baselines, prepared source snapshots
and explicit conflict choices support file operations and saves. Explorer models
cover dependencies, generated/unloaded projects, nesting, stable selection,
symbols, movement, links and membership edits. Watch/reload, lazy directory and
document loading, paging/search and skipped-path reports address large workspaces.
ZIP64, DEFLATE and streaming archive paths retain metadata while enforcing input
budgets. The completed Node scopes cover these contracts. The final actual Studio
Release13 replay passed all 16 named checks after the source and worker timer
corrections; broader storage, picker and cross-platform acceptance remains
separate. [Epic #329](https://github.com/wieslawsoltes/SharpForge/issues/329) and
[coverage](coverage.json)

### A24 E02: Explorer and template workflows

The catalog includes project, solution/configuration, C# item and XAML/WinUI
template families with option models. Destination preparation checks paths,
permissions and conflicts and handles partial creation. Recovery schemas,
migrations, quarantine, folder-handle persistence, cross-window revision
broadcasts, save ownership and conflict resolution have explicit modules and
fixtures. Round-trip corpora preserve binary and unusual-encoding cases. Native
Windows/WinUI template execution and final browser picker/recovery/coordination
flows remain subject to the named platform and browser gaps below.
[Epic #330](https://github.com/wieslawsoltes/SharpForge/issues/330) and
[coverage](coverage.json)

### A24 E03: Virtual file system providers

Memory, File System Access, OPFS, native-host and overlay providers share a
provider contract, path identity policy and source/encoding handling. OPFS has a
sync-access worker seam; provider-backed disk operations compose with unsaved
buffers, generated files and cancellation. Node conformance and mock fixtures
remain separate from browser qualification. The latest browser probe completed
OPFS read/write and plain IndexedDB operations, then the process crashed while
retrieving a stored filesystem handle. It did not reach identity comparison or
the Web Locks probe. [Epic #564](https://github.com/wieslawsoltes/SharpForge/issues/564),
[coverage](coverage.json) and [browser record](browser.json)

### A24 E04: dotnet new template compatibility

The template engine reads standard template metadata, evaluates supported symbols
and conditions, applies source-name/file transformations and consumes installed
`nupkg` template content through the bounded archive and provider layers. Wizard
composition uses explicit destination and native-context/profile contracts.
Package-free native fixtures and declared byte-parity cases are recorded; they
do not establish compatibility with every third-party package, unavailable
framework restore or Windows template target.
[Epic #565](https://github.com/wieslawsoltes/SharpForge/issues/565) and
[coverage](coverage.json)

## Worktrees, stack order and synchronization

Implementation and publication projections used isolated worktrees. Feature
branches depend on actual published prerequisites; merge-only branches join
independent prerequisites before a consumer is added. Forward maintenance retains
the previously published head as a parent. No force-push, rebase or squash was
used for this work. Main was merged for concrete dependencies/conflicts, with the
final upstream composition pinned to `1db2e1d5`; main was not repeatedly refreshed
for every moving upstream commit. [Source and workflow record](source.json)

Representative dependency layers are shown below. They are an aid to review;
the PR index contains the exact head/base/tree and ordered parents for each
publication, including side joins and subsequent maintenance.

| Consumer family | Prerequisites before consumers |
| --- | --- |
| Native services | Process #3571 → engine #3602 → SDK #3618 → transport #3638 → context #3683 / profiles #3696, then mapped build and UI consumers. |
| Solution workflows | Path/XML and reader foundations → solution mapping #3703 → mapped native build #3751. |
| Separate project assemblies | Bytecode #3719 → CIL identity #3722 → metadata #3766 → graph #3837, joined with compiler lowering #3824 before runtime #3915 and worker #3956. |
| Native UI composition | Context/profile/view/testing prerequisites → controller #3973 → registration #3991; the mechanical engine/docking cleanup #4378 retains #3991 as its parent. |

The sealed owner census contains **159 distinct feature PR identities**. Each
record preserves its actual published head, tree, immediate ordered parents,
local projection proof and receipt history. The actual-parent audit reduces
those heads to **34 maximal parents with no unresolved ancestry**. These counts
do not describe a live open/merged-state sweep. Superseded heads and failed
checks remain in their original receipts. [PR index](pull-requests.json)

## Qualification results and their scope

The consolidated runs were serial through `scripts/limited.js`. Failures were
retained, corrected in focused follow-ups, then the complete selected Node22
scope was exercised. Overlapping scopes below are not added into one test total.
[Exact commands, versions, receipts and raw-log members](qualification.json)

| Source | Scope | Result |
| --- | --- | --- |
| `bb2b8d84c8dfc0b14fc76b2c605b84d48a1e993e` | Node26.10.0, 227 selected files | 1,875 tests: 1,809 passed, 66 failed, zero skipped/cancelled. |
| `7b087e0f0e3105c71ec86e39554358766b45d3bf` | Node26.10.0, 38 affected files | 260 tests: 259 passed, one failed, zero skipped/cancelled. |
| `5269d3970f10fee404ef23e5fe3d07cb61d8750c` | Node26.10.0, eight affected files | 52/52 passed, zero skipped/cancelled. |
| `5269d3970f10fee404ef23e5fe3d07cb61d8750c` | Node22.23.3, complete 228-file selected scope | 1,877/1,877 passed, zero skipped/cancelled. |
| `e9f8a8cd2ff1aa6506e9457a7591e3915e6e9f40` | Node26.10.0, 18 existing cleanup consumers | 382/382 passed, zero skipped/cancelled. |
| `362f1337870ca5dca302ab7dc0dfc9f58629523f` | Node26.10.0, five editor ownership consumers | 40/40 passed, zero skipped/cancelled. |
| `886fb139fc647f0532085b5a0866a498fa7fca52` | Node26.10.0, 11 files including 18 retained publication-only cases and status ownership | 43/43 passed, zero skipped/cancelled. |
| `de9a5e8fe2320a5e2e5cdc56d4752def50bd9d04` | Node26.10.0, two capture-timer files | 11/11 passed, zero skipped/cancelled. |
| `7d4c97d29ae847c5810376747f5a3ac682e2dfd1` | Node26.10.0, six complete timer/worker consumers | 34/34 passed, zero skipped/cancelled. |
| `0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760` | Actual committed Studio, Chromium153 Release13 | 16/16 checks passed; no page errors; exit0. |

At `7d4c97d2`, `npm run check`, `npm run build` and clean-checkout verification
passed. The final `0bb2ed36` descendant changes only the Python browser fixture,
with exact product/build equivalence recorded. The strict structure gate still
reports **265 problems**, compared with **268 on actual pinned main**. The
recorded 159-entry allowance file is byte-identical. Complete static comparison
through `7d4c97d2` found no introduced problem rows, worsened dimensions or
frozen-file growth; the final fixture changes no checker input. No additional
strict Node run is implied. [Build equivalence](build-equivalence.json)
Seven growth cases that initially fit the older allowances were corrected by
focused extractions; the allowances were not expanded.
[Structure comparison](source-dimensions.json)

Named earlier native and differential records include actual Linux SDK10.0.201
host/reference operations, mapped solution builds and separate emitted PE
execution. Portable evaluation comparison and boundary fixtures, native template
fixtures, archive/source round trips and managed test-framework fixtures retain
their exact individual results. Those observations do not fill missing Windows,
macOS, Rust/Wasm, framework-package or browser cells. The single shared NuGet
restore ended at its 50-second bound with exit 124 and an empty cache; its only
reported progress was determining projects to restore. No specific network cause
or successful package restoration is inferred. [Coverage](coverage.json) and
[qualification/archive index](qualification.json)

## Performance review remains open

The latest matched comparison used the unchanged `benchmark-release14.js`,
Node22.23.3 on Linux x86_64, three alternating baseline/candidate pairs and twelve
warm samples per workload and engine. The baseline was pinned `1db2e1d5` and the
candidate was `e9f8a8cd`. All eight output checks passed and measured managed
allocations were unchanged. JavaScript allocations were not measured.
[Performance record and raw sample reference](performance.json)

| Workload / engine | Baseline median ms | Candidate median ms | Median change | p95 change |
| --- | ---: | ---: | ---: | ---: |
| Dictionary / source | 31.3130 | 32.0122 | +2.23% | **+10.53%** |
| Dictionary / direct CIL | 195.4584 | 191.5688 | −1.99% | **+11.27%** |
| List / source | 56.4967 | 54.7778 | −3.04% | −7.20% |
| List / direct CIL | 592.1481 | 617.3511 | +4.26% | −0.12% |
| Queue / source | 25.3216 | 28.2408 | **+11.53%** | −8.94% |
| Queue / direct CIL | 241.2896 | 215.3114 | −10.77% | −15.63% |
| Builder / source | 29.3144 | 25.9392 | −11.51% | −0.06% |
| Builder / direct CIL | 94.4320 | 83.9134 | −11.14% | **+17.54%** |

Source queue's median exceeds the contribution budget and needs justification
and sign-off. The three p95 increases above 5% also remain review obligations;
the improving queue p95 does not cancel its median result. The machine was
shared, even though root-owned heavy jobs were serial. These complete-tree
measurements do not isolate a cause. Earlier failed-budget samples and the CPU
profiles that did not reproduce their slowdown remain preserved; neither is
discarded or explained away as noise. [Performance limits](performance.json)

## Browser and protected integration gates

The Chromium 153.0.8010.12 storage diagnostic ran against built committed Studio.
OPFS write/read, opening IndexedDB, ordinary data put/get and filesystem-handle
put completed. During filesystem-handle get, Chromium exited with **SIGTRAP**.
The subsequent `isSameEntry` and Web Locks steps were not reached. This is a
reproduced failing primitive, not a passing persistence/coordination suite or an
established explanation of the browser crash. [Browser probe evidence](browser.json)

The actual release13 suite separately failed on its first `workspace.load` with
`AggregateError: Documents committed, but a view or cleanup callback failed`.
It completed **zero checks**. Subsequent editor model-ownership and status-caret
corrections retain their focused Node26 evidence. The actual Release13 replay at
`886fb139` subsequently passed ten checks covering source/designer editing,
structural insertion, conflicts, device presets and views. It then timed out
waiting for `debug.uiActive` during the retained UI-handler launch, with
`AggregateError: Workbench event listeners failed` from `AppSession.receive`.
The follow-up read-only probe located `TypeError: Illegal invocation` in
`ExecutionCapture.wake`: the browser timer default was called with the capture
object as its receiver. The minimal capture correction then passed **11/11**
Node26 cases plus check, build and clean-checkout at `de9a5e8f`. Its browser replay
again completed ten checks and removed the page errors, but the run result
reported no started applications and a worker `TypeError: Illegal invocation`.
Read-only analysis of the existing trace localized the corresponding host-timer
receiver in `RuntimeActivity`. The combined correction passed **34/34** Node26
cases and check/build/clean-checkout at `7d4c97d2`. Its browser run passed fifteen
functional checks before the legacy lifetime worker-count assertion failed.
The fixture-only descendant replaced that stale expectation with precise
designer no-churn, current ownership and live-worker bounds. At `0bb2ed36` all
**sixteen checks passed**, including the retained C# event handler and source-VM
and direct-CIL animation clocks. The historical failures are preserved with
their own sources, including both negative timer controls. [Release13 record](browser.json)

The actual `apps/studio/studio.js`, root `package.json` and `package-lock.json`
remain byte-identical to pinned main in this candidate. The prepared Studio and
lockfile changes are reviewable text patches; existing protected ownership/lease
constraints remain in effect. A generated candidate executable is not included
in this evidence tree, and the protected proposal was not executed to claim
production acceptance. Final authorized application of those patches and the
corresponding application checks remain separate steps.
[Protected base identities](source.json), [patch review](protected/review.json) and
[latest unchanged lease observation](protected/delivery-lease-readback.json)
The [complete review in the aggregate](https://github.com/wieslawsoltes/SharpForge/blob/69122b13e8ac9a02459ab1f9bc0108a25296518e/planning/evidence/project18/integration/README.md),
[Studio patch](protected/studio-entry.patch) and [lockfile patch](protected/package-lock.patch)
are directly reviewable without reconstructing the raw archive.

## Retrievable aggregate code branch

The [aggregate branch](https://github.com/wieslawsoltes/SharpForge/tree/codex/p18-final-integration)
exposes the exact canonical tree at commit
[`69122b13e8ac9a02459ab1f9bc0108a25296518e`](https://github.com/wieslawsoltes/SharpForge/commit/69122b13e8ac9a02459ab1f9bc0108a25296518e),
with all 34 actual maximal published feature heads as its reviewed parents. No large product PR, main merge, full-CI label, release or deployment is
part of that publication. The aggregate commit differs from the original
canonical commit because its actual published-parent history differs; their tree
identity matches exactly. The original source history remains in the bundle.
[Aggregate branch protocol](aggregate-branch-plan.md)

Every reviewed published-parent path absent from canonical now has an explicit
replacement, obsolescence or retained-qualification decision.
Two extracted testing files were proven duplicate assertion bodies; a separate
missing helper in the standalone runtime-source fixture was restored on its
existing PR without changing canonical product code. Unique publication-only
cases found elsewhere were retained as **18 unique cases in eight files** and
passed within the complete 43-test, 11-file Node26 scope at `886fb139`. The final
owner index preserves that omission classification and its exact source
identities; parent selection is sealed against the 159 actual recorded heads.

## Durable artifacts and how to inspect them

This evidence draft includes an incremental `artifacts/integration.bundle`
containing the original canonical source commits outside pinned-main ancestry,
and the raw `qualification-raw.tar.gz` containing the exact historical/final
logs, samples and receipts. The raw archive is stored in ordered parts because
its whole-file upload exceeded the tool transport frame limit.
[Storage and reconstruction instructions](artifacts/README.md) preserve the
whole-file identity and explicit part order. The bundle is 3,353,040 bytes and the raw archive is 66,648,668 bytes.
All 5,968 required source objects and all 1,321 archive members passed verification.
The [artifact manifest](artifacts.json) records original sizes, SHA-256 values and
Git blob identities. Binary publication and fetched-byte verification are recorded
in [artifact-storage.json](artifact-storage.json) and [the publication receipt](artifact-publication.json).
The exact fetched commit was `09f2c383ea5038684dc5d0c515ea6c027bb1d8f5`: all
17 stored binary blobs and the reconstructed archive matched their released byte
counts, SHA-256 values and Git identities. This metadata-only forward preserves
the same 17 blob identities; it does not imply another fetch or qualification run.
[Exact byte-readback receipt](artifact-byte-readback.json) · [Artifact staging](artifact-staging.json)

To restore the original source, fetch the pinned prerequisite first, verify the
bundle, then fetch its verified `codex/p18-integration` ref into a separate review branch:

```sh
git init project18-review
git -C project18-review remote add origin https://github.com/wieslawsoltes/SharpForge.git
git -C project18-review fetch origin 1db2e1d540a78403b7aaddcf472311fcde1a81ef
git -C project18-review bundle verify ../artifacts/integration.bundle
git -C project18-review fetch ../artifacts/integration.bundle refs/heads/codex/p18-integration:refs/heads/project18-source
git -C project18-review rev-parse project18-source
git -C project18-review rev-parse 'project18-source^{tree}'
```

Compare the resulting identities with `canonicalSource.commit` and
`canonicalSource.tree` in [source.json](source.json) before using the checkout.
Reconstruct the raw archive in the explicit part-manifest order and verify
the whole SHA-256 before unpacking it. The source bundle is a single file. The original source commit identities are
preserved inside the bundle; GitData creation of the surrounding evidence commit
does not replace them. [Source and artifact contracts](source.json)

Artifact publication and independent fetched-byte verification are complete. The
evidence PR receives its ordinary required core check separately from the preserved
source qualification. Remaining acceptance gates are concrete: review measured
performance budgets; handle the protected integration under its existing ownership;
and retain the unqualified framework/platform and browser clauses on their owning work items.
