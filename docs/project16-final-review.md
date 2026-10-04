# Project 16 final review: providers, source ownership and Studio integration

## Current publication and qualification

**The implementation stack through PR4105 is merged; full acceptance qualification is still incomplete.**
The eight merged PRs are
[#3451](https://github.com/wieslawsoltes/SharpForge/pull/3451),
[#3475](https://github.com/wieslawsoltes/SharpForge/pull/3475),
[#3485](https://github.com/wieslawsoltes/SharpForge/pull/3485),
[#3533](https://github.com/wieslawsoltes/SharpForge/pull/3533),
[#3843](https://github.com/wieslawsoltes/SharpForge/pull/3843),
[#3865](https://github.com/wieslawsoltes/SharpForge/pull/3865),
[#3904](https://github.com/wieslawsoltes/SharpForge/pull/3904) and
[#4105](https://github.com/wieslawsoltes/SharpForge/pull/4105).
PR4105 merged as `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`, tree
`dc9d4e337b91c6e878e7c6c7d65f013667b5ec6b`.
Its [own core](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175219507/job/111356347344)
and [main core](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175263470/job/111356461984)
succeeded; the earlier same-head run 37175211209 was automatically cancelled.

The latest complete hosted observation,
[a4 / run 37175293552](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175293552),
ran on that merged source with Ubuntu/Chromium: **15 outcomes, nine passed and six failed**.
A19 passed **710/710**; A20 reported **686 tests, 677 passed, nine skipped, zero failed**.
Sessions, HTTP workflows, standalone workflows, editor insights, editor UI budgets
and actual Studio 200 MiB ingress remained failed. The
[hosted ledger](project16-hosted-qualification.md) retains the original reports,
exact source identities and each passing or failing scope. No overlapping run
counts are added and no issue is closed by this update.

PR4105's source identity is local `0858f721e8e737e6bcca1365748409cb6b0b5f35`,
public head `cce1aa2ceb6bce8247c4ab62c76a7d56d9518370`, with identical tree
`543ac1fd0f99e60bd7be5319ecad1590ba1eeccd`. The merged tree above is the actual
a4 execution source. The [local correction archive](project16-acceptance-corrections.md)
retains initial failures and affected retries separately from hosted evidence.

The complete follow-up source is now implemented on
`codex/project16/09-hosted-followup`; its completed-scope checks and corrected
hosted/browser qualification are **pending at this documentation cutoff**.
The owning records describe:

- [Workspace document/layout reconciliation](project16-workspace-layout.md).
- [Production Watch storage registration](project16-watch-storage-correction.md).
- [Native Find history fixture and independent budget evidence](project16-editor-a4-corrections.md).
- [Standalone worker startup and diagnostics](../planning/qualification/project16-standalone-worker-startup.md).
- [Rename preview source, save and transaction ownership](project16-preview-publication.md)
  and [committed diagnostic presentation](project16-preview-diagnostics.md).
- [Same-source lazy-evaluation measurement](workbench-lazy-evaluation.md) and its
  [independent serial registration](project16-qualification-outcomes.md).

The new registration selects 16 outcomes for future `all` runs; a4 remains its
original 15-outcome execution. No moving branch HEAD or unobserved follow-up
result is embedded here. Later publication, a5 and platform results must append
their own exact identities and observations.

The review below is a **historical product/source audit**, including its
`48472269` boundary, original diff/history counts, local failures and previously
pending hosted checks. Those statements describe their recorded revisions; they
do not override the latest publication and a4 evidence above. This reconciliation
changes no source, historical result, per-leaf bound or closure recommendation.

## Historical review boundary and stack

Final product source is `48472269ec106049debc0d448985882463365215`, tree
`8ad180ab94fb21a57e6e9a5c3b17cf553015a717`; its equivalent published commit is
`2a19543ba43ef16cf73dc2c81834265f74d4ac0c`. Against captured main
`9ac2d74d2b3992e80eb697474178e58269b17ce5`, the final product net diff is
**444 files, 41,901 insertions and 1,825 deletions**, excluding this evidence-only
closure. The detailed earlier counts below are retained as historical snapshots.
Final local checks and packaging succeeded individually, but checkout integrity
failed on a recurring untracked file absent from the committed tree. Required
hosted PR core remains pending. The integration owner explicitly accepts the
measured source-model performance tradeoff described below; no overall
performance-budget, browser, native or oracle pass is claimed.

Publish one complete final implementation closure after review 04. The original source
boundary captured for this review is the committed integration tree
`789339fe1c5a05259dfd4be1395f2e849fe42fe9`. Its local review base is
`eec216696f4c1f73a5be541bfa2fac3a1f8ea42f`, the completed docking/workbench/shell
review, published as [PR #3533](https://github.com/wieslawsoltes/SharpForge/pull/3533).
That base is an ancestor of the captured head. The publication base is `main`
after review 04's merge; the stack remains foundation → editor →
sessions/runtime → docking/workbench/shell → this final closure. Final
qualification results and any resulting corrections must identify their own
exact descendant revision before publication.

The captured net diff is **348 files, 29,928 insertions and 1,529 deletions**.
These figures exclude this review document and any later qualification evidence
or corrections. The reachable history above the local base contains **258
commits: 108 merges and 150 non-merge commits**. Of the non-merge subjects, 144
start with a Work-ID. Five original Studio `feat(studio)` commits and the
initial semantic-provider commit retain their original subjects. No existing
local commit is renamed or rewritten to make the history appear more uniform.

Commit reachability and new code are different measures here. Earlier review
layers incorporated scoped committed-source snapshots while the final
integration retains the owners' original local branch histories. The net tree diff,
not the number of reachable commits, defines the remaining code for review.

Measured source identifiers in this document and the qualification archive are
**local commit IDs plus exact Git tree IDs**. Publication through the GitHub
Git-data connector preserves each tree, commit message and ordered mapped
parent graph, while GitHub sets commit metadata. A published commit can
therefore have a different SHA from its local source commit. This is not a
squash, rebase or force-push, and this review does not claim identical public
commit metadata or SHAs. The exact integration-owner
[publication map](project16-publication-map.json) pairs local and published
commits with their identical tree IDs. The qualification history repeats the
published equivalent beside each mapped measured source. For example,
`4b1c0291` maps to public `a3e431a3bdfffdb2f9a80977802fe2e8b03b9bb4`, and
`40bbdea7` maps to public `01c0c052fb30bbe447dc43bdaab85df45f06160f`.
A reviewer can check out those public commits and reproduce the recorded tree
without access to local-only commit objects. The archived checkpoint contains 441 mappings, including all measured source
identities and the final product source. The evidence commit itself is not
circularly required to appear inside its own map.

| Captured history point | Role in the final closure |
| --- | --- |
| `eec216696f4c1f73a5be541bfa2fac3a1f8ea42f` | Exact local base of review 04 |
| `08885d8b7df57c5fdae11f1da4520a6de01d903c` | Normal merge of captured session/public-main synchronization `a51e8052` into the integrated owner histories |
| `6bc2a3888f846a81f6117eca8e2fbb35435dd51e` | Normal merge of review 04 into that synchronized history |
| `c99424bcafef589a471a5840f1eeaf6e73d3eee4` | Normal merge joining the captured synchronization with complete Studio helper/bootstrap and qualification registration commits |
| `a9aa167f00238c4d4b76f3f23105c6779d22c598` | Actual disk-observer/reload wiring after the metadata, execution-capture and source-provider integrations |
| `96c7bc79552d0f95f089ea80560394c4d0344d10` | Integration owner's completed build and initial combined static-check source |
| `789339fe1c5a05259dfd4be1395f2e849fe42fe9` | Draft boundary, including browser-supervisor cleanup and the reviewed smoke/comment inventory correction |

The synchronization retains the upstream sparse builtin registry and
`createRegistry(base, base === Builtins)` behavior, numeric `DiagnosticId`,
MethodIndex improvements and CIL native ABI. Released
`StringBuilder.AppendFormat(string, object[])` remains builtin 524288;
`Environment.GetEnvironmentVariable` remains 524289. The source-argument,
environment and semantic-provider work is preserved alongside those upstream
contracts. These were merge decisions, not newly invented replacement APIs.

## Later synchronized source boundary

The original history and size inventory above remain pinned to `789339fe`.
The later source `1699e53a664bb54752a216a98f59a9f947da5eeb` has tree
`5f95b2569f1d37e14108ca865cb39de33872320e` and includes the completed provider
optimization plus captured `main` at
`9ac2d74d2b3992e80eb697474178e58269b17ce5`. Against that captured main, the
source net diff is **443 files, 41,696 insertions and 1,824 deletions**. These
figures exclude later evidence changes. Already-landed work brought in by main
is not presented as newly authored Project 16 changes.

The exact [merge-decision record](evidence/project16-integration/p16-main-conflict-decisions.json)
retains all 59 reported conflicts: 52 files where main matched review 04 kept
the integrated owner changes; six where our source matched review 04 accepted
main; `compilation.js` combined both sides against the reviewed base. No
unresolved conflict is recorded.

For the next performance comparison, the
[matched baseline construction](evidence/project16-integration/p16-matched-baseline.json)
combines pre-signature source `3f7e51a6` with the same captured main, producing
`ceced1c2ad0b7acead2333609d8568ab41f2f902`, tree
`5a805282c2662f09047b75d7a43c191b06956ea9`. Its public equivalent is
`45319b4df1f8364b387a66db90acf33b434d03f7`, retained on
[`codex/project16/benchmark-baseline-9ac2d74d`](https://github.com/wieslawsoltes/SharpForge/tree/codex/project16/benchmark-baseline-9ac2d74d).
Both revisions use the same revised harness. The revised harness measures first-query and repeated-query
cost separately from binding; moving index construction into a first query is
not treated as eliminating its cost. The original reports remain archived and
are not paired with reports from the revised harness. The matched measurements and later core/packaging attempt are recorded below;
the final compiler capture correction is recorded below. A narrow checkout
retry passed at the earlier source, but the final local attempt failed again
on the recurring file; required hosted core remains pending.

## Why one final closure

The advisory pull-request size in [CONTRIBUTING](../CONTRIBUTING.md) is roughly
15 files or 800 changed lines. This closure is substantially larger. Its
justification is the existing dependency graph and the requested
implementation-first, complete-scope validation schedule; it is not an
exception to source-file, package-boundary or evidence requirements.

The apparent source/provider cutoff, `6bc2a388`, contains tests that import
Studio modules introduced by later original commits. It is not an
import-complete review head. The later helper sources become complete before
the final bootstrap, but those existing heads do not contain review 04/main
synchronization. The first existing descendant of review 04 with those helpers,
`c99424bc`, already includes the real Studio bootstrap (`3af10561`) and staged
qualification registration (`e8345a20`). It still precedes the final disk
observer, core-intrinsic metadata and measured execution-interval corrections.

| Original fixture commit | Required original source commits | Consequence for a proposed early cutoff |
| --- | --- | --- |
| `8b0e0ce3`: `a19-studio-language-providers.test.js` | `ec4b890b`: `studio-language-providers.js` | The test exists at `6bc2a388`; its imported host module does not |
| `bb5c6bb9`: Studio save and Explorer ownership tests | `eb0294bb`: loader fixture, source imports, workspace loader and Explorer host; `9f03310e`: final coordinated save behavior | The early test commit does not make the corresponding helper implementation available |
| `c7c80de4`: `a19-studio-workspace-inputs.test.js` | `eb0294bb`: loader/source imports/fixture; `4f061fa2`: workspace input adapter | This test is absent at `6bc2a388`, then enters history before its helper sources |
| `5fccae3b`: `a19-studio-import-composition.test.js` | `eb0294bb`: loader/fixture; `4f061fa2`: file and built-in import adapters; `ec4b890b`: metadata reference adapter | This test also arrives after `6bc2a388` and before all its imports |

A newly constructed merge-only component branch could retain original local
commit identities, but it would need another set of integration/conflict decisions and
an intermediate source tree with older Studio wiring and a separately assembled
manifest. It would not be the already completed source scope being qualified.
Taking snapshots or replaying commits to manufacture a smaller diff would also
discard the requested direct owner-history relationship. The chosen closure
therefore retains the original merges and reviewable Work-ID batches and
qualifies their actual combined result once. Follow-up corrections remain
ordinary forward commits.

## Net scope inventory

Counts below are the exact `eec21669..789339fe` tree difference. Package counts
include their API documentation, examples, benchmark data and generated tables
where those live inside the package.

| Path class | Changed files | Remaining work represented by the diff |
| --- | ---: | --- |
| `apps/studio/` | 109 | Actual workspace/document/editor/session composition; bounded source ingress and saves; Explorer resource transactions; project-owned language and test providers; metadata, task, navigation, keyboard, execution-capture and disk-observer adapters |
| `packages/text/` | 22 | Pinned Unicode grapheme data, exact indexed visual columns and cooperative prepared text edits |
| `packages/editor/` | 32 | Source loading/save preparation, view/model integration corrections, ReSharper-like bindings, provider transactions and reactive CodeLens/rename/action UI |
| `packages/compiler/` | 12 | Bound source symbols, inheritance, references and argument mappings; retained `nameof` reference identity; shared builtin metadata seam |
| `packages/language/` | 7 | Typed source queries, rename plans, signature/hover metadata and parameter-name hints |
| `packages/refactoring/` | 5 | Validated Fix All, detached plan validation and safe lossless Outline member reordering |
| `packages/bytecode/` | 3 | Public shared builtin owner/member/parameter metadata used by compiler and inspection UI |
| `packages/project-system/` | 14 | Prepared source records, bounded decoding/encoding, disk ownership and accepted observation baselines |
| `packages/msbuild/` | 2 | Captured native disk/client observation contract |
| `packages/protocol/` | 2 | Language protocol mappings for the same source-backed services |
| `packages/workspace/` | 2 | Source identity/budget support consumed by the host |
| `scripts/` | 25 | Standalone worker/module packaging, source-bound import inventory, real editor benchmarks and serial qualification runner |
| `tests/` | 87 | Focused provider/ownership/large-source/worker regressions, Unicode fixture, real Studio browser drivers, scope manifests and shared fixture infrastructure |
| `docs/` | 25 | API contracts, source-specific evidence, explicit limits and owner integration records |
| `.github/workflows/` | 1 | Explicit serial Project 16 qualification dispatch |
| **Total** | **348** | **29,928 inserted and 1,529 deleted lines** |

### Semantic and editor behavior

Source binding supplies namespace/base-type identities for Class View,
declaration/read/write classifications for reference filtering, actual
argument-to-parameter mapping for hints and structured metadata for definition
inspection. Quick Actions supports its advertised Fix All families in document,
project and solution scopes using isolated project compilations. Linked-file
edits are reconciled and validated in each affected context.

Rename covers supported bound types, members, locals and parameters, optional
lexer-scoped comment/string occurrences, and type-associated filename changes.
The preview and commit validate every document owner/version and project
membership; resource changes delegate the complete text/file/project-XML plan
to one Explorer transaction. Actual TestProviders contribute status and run
commands to CodeLens through source/project ownership checks and invalidations.
Outline reorder uses the shared lossless syntax and validated workspace-edit
path. See [provider contracts](editor-language-providers.md),
[provider evidence](editor-language-provider-evidence.json),
[test CodeLens](a20-test-code-lens.md) and
[resource transactions](a19-resource-rename.md).

### Large sources, ownership and I/O

The persistent model now exposes exact cooperative visual-column lookup and
private edit preparation without flattening a whole large source. Explicit
ingress preserves encoding/BOM and source identity across prepared models,
project discovery, Explorer operations and saves. Save As acquires its picker
before asynchronous preparation; only the captured normalized source can become
the saved baseline. Later edits stay dirty.

Workspace tickets cover every opening route, including cancelled or superseded
pickers. Metadata and models adopt through one ownership boundary. External
change prompts retain the observed record and destination; reload accepts the
corresponding disk baseline on the same save queue before notifications. These
contracts are described in [Studio composition](project16-studio-composition.md),
[prepared documents](a19-prepared-documents.md),
[atomic reload](a19-document-reload.md),
[disk observation](../apps/studio/workbench/studio-disk-observer.md) and the
[text/native evidence ledger](project16-text-native-evidence.md).

### Real Studio host and diagnostic tools

The application bootstrap supplies the actual shared DocumentService,
ProjectSystem, session manager, editor factory, Task Center, navigation,
metadata and resource-transaction contributions. Tests exercise those helper
contracts with real owning models/services; browser fixtures drive the actual
Studio composition. Independent application windows retain session selection,
output and execution ownership. Legacy WinUI inspection resolves the active
application's existing host rather than creating a duplicate host.

Object Browser and Code Definition share bounded referenced-PE and registered
framework/core metadata. Diagnostics retain execution, event and memory
histories by committed application launch. The worker reports actual measured
execution intervals and stale replies cannot populate a replacement session.
See [metadata providers](project16-metadata-providers.md),
[execution measurement](project16-execution-timeline.md),
[native tasks](a19-native-task-integration.md) and
[session evidence](a19-session-evidence.md).

## Original review units retained

These are navigation points into the preserved history, not replacement
aggregate commits. Their focused evidence remains attributed to the source
revision that was actually run.

| Original commit(s) | Work-ID and review responsibility |
| --- | --- |
| `e688ce9c`, `e43c811e` | SF-A20-T04.5: exact visual columns, pinned Unicode and explicit host-segmentation qualification |
| `9ab575c9`, `acdf945d` | SF-A20-T44: prepared chunked source loading and rebased source identities |
| `5d28d536`, `a1f8976c` | SF-A19-T01.3: prepared document adoption and restored document state |
| `fe2c20f7`, `164b09f7`, `58bfc06d`, `54892a70` | SF-A20-T44/T45: captured Save As, bounded save preparation, cooperative transactions and exact caret preservation |
| `c4fe63eb`, `14d5d1cd` | SF-A20-T19: one guarded source/resource transaction and accurate save-timing evidence |
| `56302204`, `a1153ceb`, `3e5b3e83` | SF-A19-T20: safe Outline provider, parser-recovery rejection and accessible cancellable UI |
| `6bbb1dca` | SF-A20-T18: actual test registry/status CodeLens |
| `3f1d57b8`, `ee32eebc`, `4ffe976e` | Original semantic-provider source; SF-A20-T19 preview/reference corrections; SF-A20-T16 final provider evidence |
| `c33b162a`, `79c888a6`, `f0e5186b` | SF-A19-T42: ReSharper-like profile, applied environment schemes and source-specific qualification |
| `bf3988f6`, `2c752af0` | SF-A19-T35: background/native jobs and captured cancellation ownership |
| `bc5919e5`, `4fd13a82`, `555b600e`, `3b3f6546` | SF-A19-T17/T23: referenced metadata, public builtin shape seam and canonical core/framework signatures |
| `1a4d8b8a`, `23f5c45d`, `379321a3` | SF-A19-T26: worker execution intervals, retained per-launch graphs and complete measured interval rendering |
| `a7080ffd`, `03797840`, `9d36c177` | SF-A19-T01.3: atomic reload, notification races and correction-aware qualification evidence |
| `a0ac4ab1`, `6d70fa30`, `a9aa167f`, `168fcf02` | SF-A19-T41: captured observations, native/cancellation guards, actual Studio wiring and completed observer evidence |
| `eb0294bb`, `4f061fa2`, `9f03310e` | SF-A20-T44 / SF-A19-T01: explicit source workspace, import and save host adapters |
| `ec4b890b`, `3af10561` | SF-A19-T16 / SF-A19-T01: project/provider/navigation composition and final Studio bootstrap |
| `e8345a20`, `9aa018fd`, `b1c933f7` | SF-A20-T51: serial completed-scope qualification, reuse of the completed build and bounded browser-supervisor cleanup |
| `14019d1c`, `68017508`, `5deb1074` | SF-A19-T11.3: reviewed literal imports and exact integrated source inventory |

The complete non-merge inventory is reproducible without changing the checkout:

```sh
git log --reverse --no-merges --format='%H %s' \
  eec216696f4c1f73a5be541bfa2fac3a1f8ea42f..789339fe1c5a05259dfd4be1395f2e849fe42fe9
git diff --stat \
  eec216696f4c1f73a5be541bfa2fac3a1f8ea42f \
  789339fe1c5a05259dfd4be1395f2e849fe42fe9
```

## Recorded qualification history

The [machine-readable qualification history](project16-qualification-history.json)
retains each source commit and tree, exact invocation where captured, raw log
path and SHA-256 digest. The raw outputs are under
[evidence/project16-integration](evidence/project16-integration/). Preparing
this archive ran no test, build, benchmark or static gate. Results below are
completed integration-owner executions; every result applies to its recorded
source rather than automatically qualifying later changes.

| Evidence | Recorded result and source |
| --- | --- |
| Initial normal build | Passed at `96c7bc79`; a built distribution is not browser execution or standalone qualification |
| Initial full static check | At `96c7bc79`, manifest assignment covered 617 Node files and 32 browser scripts; 2,504 syntax modules and 2,500 linked modules had no errors. The attempt failed four reviewed-byte policy messages across two files |
| Initial static correction | Exact source inventory corrections were followed by the static-import-only retry at `6d5b033f`: 2,500 modules, zero errors. Contract and quarantine checks also passed at that source |
| Initial A19 complete scope | At `96c7bc79`: 592 cases, 579 passed, 13 failed. The nine-file correction at `dacdd697` ran 83 cases, 81 passed, two failed; the final affected Explorer retry at `6d5b033f` passed 5/5. All 13 initial failures have observed affected passes; the full 592 cases were not rerun |
| Initial A20 complete scope | At `96c7bc79`: 610 cases, 601 passed, zero failed, nine skipped. Eight are explicit unsupported Vim/host targets; one is an unavailable pinned Unicode 16 native Intl oracle. None is a passing acceptance target |
| Later acceptance/host corrective cohort | At `4b1c0291`: 33 files, 305 cases, 302 passed, three failed, zero skipped, 12.237 seconds |
| Targeted corrective retry | At `40bbdea7`: exactly the three failing files, 36/36 passed, zero skipped, 1.674 seconds. All 305 distinct corrective cases now have passing observations across the two runs; this is neither 341 distinct cases nor a full 305-case rerun at the corrected source |
| Later complete static check | At `89ba3443`: 30 areas, 632 Node files, 32 browser scripts, zero unassigned or duplicate entries; 2,542 syntax modules and 2,538 linked modules, zero errors |
| First provider-binding comparison | Candidate `40bbdea7` against baseline `3f7e51a6`, same harness SHA, matched compiler/model observations. Two bind medians exceeded 5%: instance overloads +5.66%, local functions +12.03%. The exact initial costs remain archived; the subsequent concrete source correction has its own matched-main capture |
| Synchronized complete A19 scope | At `1699e53a`: 662/662 passed, zero failed or skipped, 35.785 seconds |
| Synchronized complete A20 scope | At the same `1699e53a`: 674 cases, 665 passed, zero failed, nine explicit skips, 33.763 seconds. The skip split remains eight unsupported Vim/host targets and one unavailable pinned Unicode 16 Intl oracle |
| Provider/upstream affected scope | At `1699e53a`: eight files, 50/50 passed, zero skipped, 5.857 seconds. This is a separate overlapping scope, not 50 additional cases added to earlier totals |
| Matched-main provider comparison | At `1699e53a` against `ceced1c2`, identical revised harness and matched compiler/model observations. None of eight shared compile/bind medians exceeds +5%; constructed-generic bind p95 increased from 27.546 to 36.100 ms (+31.05%) and retained heap median increased 110,136 bytes. These costs remain explicit, with no unconditional performance-budget pass |
| Targeted 101-sample generic capture | Same product snapshots, new matched case-filter harness. Compile median 38.704→41.498 ms (+7.22%), p95 46.736→59.549 ms (+27.42%); bind median 22.992→21.984 ms (-4.39%), p95 33.709→27.128 ms (-19.52%), retained bind heap +109,104 bytes. The compile budget exceedance remains flagged; no aggregate performance pass or causal explanation is claimed |
| Capture-policy affected scope | At `48472269`, tree `8ad180ab94fb21a57e6e9a5c3b17cf553015a717`: ten files, 65/65 passed, zero skipped, 7.028 seconds, including four new capture-ownership cases. Focused measurement and the final local core attempt are recorded below |
| Final capture-policy measurement | At `48472269` against matched baseline `ceced1c2`, 101 samples after ten warmups. Compile median/p95 43.720/67.302→40.895/48.185 ms (-6.46%/-28.41%). Source-model construction median/p95 22.198/31.018→24.411/32.235 ms (+9.97%/+3.92%), retained heap +117,112 bytes. Source-model median exceeds the 5% budget; no overall performance pass is claimed |
| Synchronized core/packaging attempt | At `756ff0cb`: check passed with 728 Node files, 32 browser scripts, 2,880 syntax modules and 2,876 linked modules, zero errors; local immutable contract/seam review and quarantine passed. This is a local snapshot review, not a hosted PR event |
| Synchronized normal/standalone packaging | At `756ff0cb`: normal build passed; direct standalone build produced 14,599,540 bytes with five embedded worker graphs. No browser execution is implied |
| Checkout integrity in that attempt | Failed: the upstream-deleted `packages/clr/src/type-system/metadata-method-definitions.js` reappeared as untracked after its preexisting copy was preserved outside checkout. The overall core attempt remains a recorded failure; a separate narrow retry is described below |
| Checkout diagnostic retry | At unchanged `756ff0cb`, the exact unexpected file was preserved outside checkout. Both `npm check` and clean-checkout passed, and the file did not regenerate. This is an affected retry, not a rerun of the complete six-step core attempt |
| Changed-source structure comparison | At `756ff0cb` versus captured main: 256 changed source files, zero introduced metric violations. Two inherited maximum line lengths remain unchanged (`tools/core.js` 1,952; `compilation.js` 684). This is not a strict global structure-gate pass |
| Final product-source static/review/package steps | At `48472269`: 729 Node files, 32 browser scripts, 2,881 syntax modules and 2,877 linked modules, zero errors; local snapshot contract/seam review, quarantine, normal build and direct standalone build passed. Standalone output is 14,600,248 bytes with five embedded worker graphs |
| Final product-source checkout and hosted gate | Local checkout failed again on the same 3,324-byte upstream-deleted file, absent from the committed tree. The exact original file was preserved repeatedly; no cause is invented. No further local retry is planned. Required hosted PR core on its fresh Git checkout is **pending**, so final core is not reported all-pass |
| Actual browser/OS/native-editor/oracle matrix | No pass is inferred from authored fixtures, Node adapters, manifests, workflow definitions or a successful build |
| Browser and workbench performance comparison | Requires actual captures and a compatible reviewed baseline; capture-only output is not a regression verdict |

The later complete source includes caret-aware and incremental search,
lossless Surround With indentation and source endings, line-ending-aware tab
conversion, bound method completion and signature help, project-owned Call
Hierarchy, startup/instance/stop-all menus and selected-profile routing,
navigation reveal ownership, diagnostic producers, captured build cancellation,
Explorer decorations and the explicit qualification-trigger fallback. The
305-case cohort exercised this combined scope after implementation.

Two failures in that cohort were stale fixture expectations: the worker
protocol's handler count and the now-intentional forwarded `projectId`. The
third exposed a real portability/lifecycle bug in capture-phase navigation
listener removal during document unload. The original failed run remains visible; corrected fixtures and the
listener source then passed the three-file retry. Older and newer cohorts
overlap, so their counts are never added into a fabricated aggregate pass total.
The later full A19/A20 executions at synchronized source `1699e53a` include
the completed corrections and their expanded case inventories; they are new
recorded runs, not rewritten versions of those earlier failures.

The first binder run used Node v24.19.0 on Linux/x64, an AMD EPYC 9V74 host,
15 measured samples after five warmups, 96 call sites and explicit GC. The
same-host baseline/candidate reports retain every compile and source-model bind
median, p95 and heap observation. Retained live-result heap increased by 74,176
bytes for instance-overload binding and 52,368 bytes for local-function binding
in that run. Uncollected heap is a GC-dependent proxy, not total allocations.
No speedup, noise explanation or statistical-significance claim is inferred
from these descriptive shared-host results. Comparison exit zero establishes
compatible observations; it is not a performance-budget pass.

The synchronized performance source defers each document's signature index until
its first query and retains compact bound invocation records. Both sides of the
revised comparison include the same captured main, use 15 samples after five
warmups, and share harness SHA
`f654fedb21cf64751ef8ba4bbb1b5fa91c42afab43d406f5af3fc911fd1f55e8`.
The generic bind p95 increase remains recorded even though no shared median
exceeded 5%; it is not dismissed as noise. At 15 samples the reported p95 is
the maximum observation. A single targeted 101-sample, 10-warmup capture examined that cost on the
same source snapshots with its own identical baseline/candidate harness; the
original reports remain intact. The first query's measured cost is
explicit rather than hidden by the binding-only measurement:

| Candidate-only signature query | First query median / p95 (ms) | Repeated-query median / p95 per query (ms) |
| --- | ---: | ---: |
| Instance overloads | 0.261 / 0.392 | 0.00768 / 0.00966 |
| Constructed generic receiver | 0.271 / 0.371 | 0.00488 / 0.00586 |
| Local functions | 0.172 / 0.253 | 0.00623 / 0.02777 |
| Incomplete instance call | 0.255 / 0.297 | 0.00812 / 0.01280 |

The baseline has no public `signatureHelp` API, so those rows establish actual
candidate costs, not before/after speedups. Repeated-query numbers divide a
64-query batch after priming. First-query and binding phases use separate fresh
models, so their medians are not added into an unmeasured total. Retained-heap
and uncollected-heap values, including negative values, remain in the raw
reports without clipping or allocation-count claims.

The one targeted larger-sample diagnostic retained the same product source
snapshots and measured only the constructed generic case. The compile median
increased **7.22%** and p95 **27.42%**, so the result does not qualify as an
unconditional contribution-budget pass. Lower bind timings in that capture do
not offset the compile cost. First-query p95 was 0.415637 ms; the primed
64-query batch's p95 divided per query was 0.007167 ms. The source-path review found that public compile/Compilation/pipeline/fallback
files were byte-identical, but generic fallback called the changed
`BodyBinder.invocation` and allocated editor records. Identical entry files did
not establish an identical dependency path. The concrete correction in
`bee4b124` defaults capture off for compilation and opts in for source-model
binding. A model reusing fallback analysis retains its existing query indexes;
its first signature query privately captures once. A new candidate-only
compiled-model first-query phase must measure that extra full binding and
retained analysis. The complete affected ten-file scope passed 65/65 at `48472269`; its focused
capture and final local core attempt are recorded below.
The source finding does not attribute the entire measured 2.7937 ms median
compile difference to records or remove the earlier budget exceedance. No
additional broad capture is planned as part of this evidence update.

The constructed-generic compile benchmark's actual result is an execution-
profile rejection: four `SF1012` diagnostics and `SF2200`, with no emitted
image. Matching that result across revisions is not successful generic code
emission. The source-model and signature phases have their own actual query
results in the reports.

The completed capture-policy measurement retains the cost of the intentional
bound-candidate records used for signature help. Source-model construction's
**+9.97% median** exceeds the contribution budget, even though the compile
measurements are lower. Direct-model first-query p95 is 0.425181 ms; primed
repeated-query p95 is 0.007328 ms per query. A model reusing completed compilation
pays a distinct first-query cost: **9.594653 ms median, 14.425250 ms p95 and
399,704 bytes retained heap median** for its private capture analysis. The
baseline has no equivalent signature API, so no before/after query percentage
is invented. The root integration agent **explicitly accepts this measured SF-A20-T14
correctness tradeoff**: bound candidates support correct signature information,
compilation capture is disabled, and both direct and deferred query costs are
measured. The provider owner recommended that disposition. This is integration
review acceptance, **not human approval or an overall 5% performance pass**. All earlier
reports remain available, and no optional benchmark loop is planned.

`tests/manifests/A19.json` includes the A19 Node glob and actual workbench
browser drivers. `tests/manifests/A20.json` includes A20/editor/text cases and
the insights, language-provider and view browser drivers.
`tests/conformance/browser/project16_suites.py` registers nine explicit
workbench/editor entries with the bounded shared runner. The
`project16-qualification.yml` workflow and `scripts/project16-qualification.js`
run selected Node, browser and performance stages serially, reuse the completed
build and retain results on failure. Scheduling follows
[serial validation](../planning/qualification/serial-validation.md).

The explicit [qualification branch trigger](project16-qualification-trigger.md)
retains manual dispatch and permits one selected platform/engine/stage from a
strictly validated branch name at an immutable checkout SHA. Its resolver tests
passed within the later corrective cohort. No hosted workflow execution is
claimed by the source or those tests; the integration owner schedules actual
qualification after the required PR/main checks pass.

Owner-focused histories also remain distinct. The language-provider ledger
records its initial 138/141 result, 26/26 affected correction and final 63/63
corrective cohort. The resource ledger retains its 72/73 run followed by the
affected 6/6 save-file result. Reload and observer ledgers preserve their own
real runs and fixture corrections. Passing a later run never turns an earlier
failed execution into a pass.

## Explicit product and evidence limits

- Semantic queries follow the implemented C# binding profile. Failed overloads
  do not receive invented parameter hints. Fix All covers its advertised
  explicit/implicit local-type families; it is not a promise to fix every
  diagnostic emitted by an arbitrary extension.
- File rename requires a matching type filename and the whole-plan resource
  host. Native atomic resource rename is disabled because the existing native
  mutation protocol has partial-write/undo semantics. The resource adapter
  rejects unsupported create/delete and destination-collision plans. Ordinary
  versioned text rename remains separate from that capability.
- Safe Outline reordering rejects different containers, syntax recovery,
  crossed directives and initialization/layout-sensitive members. Metadata-only
  or generated documents remain read-only.
- Referenced PE metadata is inspected, not executed or newly admitted into
  unsupported source compiler bindings. Missing/ambiguous references and
  undecodable signatures remain visible diagnostics.
- The Diagnostics CPU view explicitly measures **worker execution occupancy**
  in the Studio source/direct-CIL JavaScript workers. It does not claim an OS
  process CPU counter, native hardware sampling or a CLR call-stack profiler.
- Built-in replacement/preview plans cap edited document text at 32,000,000
  UTF-16 units. The same preparation path applies to Replace Current, Replace
  All and Preview; it is not a preview-only limit. Find remains independent.
- Large-source ingress supports the documented 256 MiB per-file and 320 MiB
  workspace byte budgets. Automatic recovery has a separate 8 MiB budget;
  automatic observation/reload is bounded to 8,000,000 UTF-16 units. Explicit
  chunked reopen and save are distinct operations. Large-file editing support
  does not enable unbounded semantic analysis or compilation.
- Pinned Unicode 16 fixture coverage and exact model-column measurements are
  recorded. A host with different ICU Unicode data is not reported as the full
  matching-version native oracle. Physical IME, bidi navigation, accessibility,
  clipboard and platform shortcut behavior require their actual environments.
- Model timings, retained Node heap deltas and real filesystem fixture results
  keep their measured backend labels. They do not establish browser frame
  latency, DOM retention, browser file-permission behavior or desktop-native
  parity. The 200 MiB browser typing target and performance regression verdict
  remain subject to actual captured measurements.

Publication should retain these limits and attach the integration owner's final
scope results. Issue-closing statements must follow each issue's actual
acceptance evidence rather than the existence of a provider, test file or CI
workflow.
