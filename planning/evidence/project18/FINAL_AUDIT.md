# Project 18 final source and publication audit

This audit is sealed against product/test source
`0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760`, tree
`7399d972ea939b8a5f05f894bc793f9b713cfd49`. It records implementation presence,
publication provenance and named qualification results separately. It does not close issues or claim
that every acceptance criterion, operating system or browser has passed.

## Coverage and publication

| Measure | Final recorded result |
| --- | --- |
| Project inventory | 189 issues: 8 epics, 24 parent tasks and 157 leaves |
| Leaf mappings | All 157 leaves have implementation records; no missing or unknown leaf ID |
| Implementation records | 166 across seven owner manifests; nine leaves have multiple contributors |
| Published review PRs | 159 distinct recorded PR identities, including product, qualification and cleanup units |
| Publication provenance | All 159 have an actual remote head, exact tree, verified local source/projection and ordered remote parents |
| Canonical port paths | 179 examined; 165 match exact current feature blobs; 14 are explicit aggregate compositions |
| Unexplained source omissions | None in the audited port inventory |

The publication census has 26 filesystem/delegated, 25 template, 30 workspace, 27 native,
23 evaluator, 23 testing and five root-owned review PRs. Forward maintenance is counted once per PR;
merge-only dependency branches are not additional PRs. The census is a named-receipt snapshot, not
an assertion about later changes to GitHub branches or main.

The [coverage file](coverage.json) contains every issue record and the exact owner-manifest inputs.
The full original rollup, including its old source and 21 overlapping leaves, is preserved unchanged
in [history/coverage-35251755.json](history/coverage-35251755.json). Its pending status wording is
historical. Component acceptance clauses remain attributed to their source manifests; later
whole-source qualification is recorded separately.

The [publication index](final-publication-audit.json) is the authoritative 159-row handoff. In
particular, each row exposes `publishedHeadAtReceipt`, `exactTree`, `orderedRemoteParents` and
`localSourceHead` directly. The API-created remote commits and original local/source commits retain
their different identities. No rebase, force push, main refresh or workflow dispatch was performed
for this final audit.

## Exact parent corrections

The package atomicity PR #3802 has actual immediate parent
`01fe9aba66ee5338244d622ab9531ec5ab8f21eb`. The earlier flattened `e1412f65` value was a local
projection parent. Its source identity remains historical; the actual remote parent is taken from
[the immutable GitData response](publication-gitdata-readbacks.json).

The last draft, #4447, has remote head `675e1f86ace7510a9d9744db3d88773a862d254c`, exact tree
`ca549b38d09f29c0810d29bb0712e0cdca3cb6b0`, and local projection
`e42773833954c386c8df3579d373c6d6b6189aeb`. Its immediate remote parent is
`4b584525854f767579c3e8463adc4c0972bc5119`; its PR base is the earlier #4301 head
`4d209fb03d43131fae53c0de3edc57627c239e50`. These are distinct relationships. The
[final parent response](publication-final-parent-readbacks.json) preserves both the current object
and the older intermediate joins. Required core run `37185578856`, job `111386673663`, passed on
that exact feature head. Its superseded automatic run remains recorded as cancelled.

The old current-head entries for #3719, #3722 and #3766 were also replaced with the owners' already
published forward heads. Historical failures and older parent fields remain visible, while actual
Git objects/readbacks determine the current ancestry.

## Source paths awaiting aggregate publication

The [path audit](final-port-path-audit.json) compares the final source blobs with all 159 recorded
feature trees. Every unmatched path has an explicit disposition:

| Composition | Paths |
| --- | --- |
| API, documentation and policy unions | `packages/cil/README.md`, `packages/cil/src/index.js`, `packages/language/README.md`, `packages/msbuild/README.md`, `packages/msbuild/src/msbuild-client.js`, `packages/project-system/README.md`, `packages/project-system/src/index.js`, `packages/workspace/src/index.js`, `scripts/conformance/static/allowlist.json` |
| Retained qualification-file compositions | `tests/a24-disk-scan.test.js`, `tests/a24-reload-coordinator.test.js`, `tests/a24-save-locks.test.js`, `tests/a24-vfs-memory.test.js`, `tests/a24-vfs-native.test.js` |

The first group combines published APIs, documentation or reviewed policy records. The second
retains distinct assertions from published projection suites without duplicating the full suites.
All 18 identified unique assertions were retained in eight source files and passed within the
43-case correction scope. The [published-only test map](filesystem-published-only-test-map.json)
keeps exact provenance, duplicate coverage and obsolete upstream-deleted syntax fixtures separate.

These 14 exact combined blobs belong to the root aggregate publication. The protected
`apps/studio/studio.js`, `package.json` and `package-lock.json` are tracked separately with their
actual final hashes. This audit does not claim that the prepared protected-entry patch was applied.

## Qualification retained with source boundaries

| Source and scope | Observed result |
| --- | --- |
| `bb2b8d84`, initial Node 26 synchronized scope | 1,875 cases: 1,809 passed, 66 failed; retained as a failed aggregate |
| `7b087e0f`, first affected correction | 260 cases: 259 passed, one failed; retained as a failed aggregate |
| `5269d397`, final resource correction | 52/52 Node 26 cases passed |
| `5269d397`, complete Node 22 scope | 1,877/1,877 passed across 228 files; no failure, skip or cancellation |
| `e9f8a8cd`, legacy contribution correction | 382/382 Node 26 cases passed across 18 files; check/build/clean-checkout passed |
| `886fb139`, status and retained assertions | 43/43 Node 26 cases passed across 11 files; check/build/clean-checkout passed |
| `de9a5e8f`, browser capture timer correction | 11/11 Node 26 cases passed; check/build/clean-checkout passed |
| `7d4c97d2`, complete timer-owner correction | 34/34 Node 26 cases passed across six files; check/build/clean-checkout passed |
| `0bb2ed36`, actual Release13 browser | 16/16 checks passed in Chromium 153.0.8010.12 over HTTP with real workers, no page errors, exit 0 |

These scopes overlap and must not be added into a new total. The final browser uses the built,
committed actual Studio. No proposed entry patch was substituted. Its 16 checks cover the named
C# designer/source synchronization, source/CIL animation clocks and current worker/session
ownership. Only the Python fixture differs between final `0bb2ed36` and qualified product/build
source `7d4c97d2`.

See [canonical qualification](canonical-port-qualification.json),
[status/retention qualification](final-status-retention-qualification.json),
[timer qualification](timer-qualification.json) and
[final browser qualification](final-browser-qualification.json). Raw JSON and logs are preserved
with hashes. The complete root archive is retained by evidence commit
`cba546ab959247462ce319f89683c06b7861c4ff` under
`planning/evidence/project18/integration/final-qualification`, including prior failures and controls.
No qualification or performance run was repeated for this audit.

## Contribution and performance boundaries

The [source dimension proof](source-dimensions-0bb2ed36.json) compares actual pinned main
`1db2e1d5`, the qualified cleanup `e9f8a8cd`, and final source. The final source has 265 inherited
strict-structure findings, unchanged from e9 and down from pinned main's 268. There is no introduced
or worsened finding and no growth in any of the 159 explicitly frozen files. The baseline and
checker bytes are unchanged. The inherited strict gate remains failing; this comparison does not
rename it a passing gate.

The [benchmark path proof](benchmark-path-equivalence-0bb2ed36.json) establishes that the release14
script, declared compiler/runtime dependency trees and benchmark input files are unchanged from e9
through final source. It makes no new timing claim. The latest matched measurement compares
`e9f8a8cd` with pinned `1db2e1d5` in three alternating pairs, with 12 warm samples per workload
and tree. Queue/source median increased **11.528%** and string-builder/CIL p95 increased
**17.541%**. All eight output checks passed and managed allocation counts were unchanged;
JavaScript allocations were not measured. Performance-budget review remains open. See the
[queue analysis](evaluator-queue-performance-review.json) and the archived final measurement at
`qualification/final/raw/performance-e9f8a8cd/benchmark.json`.

The [earlier performance review](integration/upstream-performance/REVIEW.md) remains historical:
its `b34fa27b` to `c1a662d1` comparison recorded dictionary/source +10.66%, dictionary/CIL
+34.40% and queue/CIL +8.42% median changes. Those are distinct from the later pinned-main
measurement. Shared-host limits and sampled-profile disagreements remain part of the evidence;
no causal correction or performance sign-off is claimed.

Windows-native XAML/framework execution, unrun browser/OS/architecture cells, native
picker/revocation and the persisted directory-handle diagnostic remain unqualified. Portable
MSBuild/runtime limitations remain explicit diagnostics. The final browser pass, the 159 drafts,
and complete issue mappings do not override those acceptance boundaries.
