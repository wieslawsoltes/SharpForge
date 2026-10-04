# Project 16 final review: providers, source ownership and Studio integration

## Review boundary and stack

Publish one complete final implementation closure after review 04. The source
boundary for this draft is the committed integration tree
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
commit is renamed or rewritten to make the history appear more uniform.

Commit reachability and new code are different measures here. Earlier review
layers incorporated scoped committed-source snapshots while the final
integration retains the owners' original branch histories. The net tree diff,
not the number of reachable commits, defines the remaining code for review.

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

A newly constructed merge-only component branch could retain original commit
identities, but it would need another set of integration/conflict decisions and
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

## Qualification status at this draft boundary

This document was prepared by reading committed history, source paths and the
existing evidence. Its author did not run tests, a build or static gates. The
integration owner supplies the final combined results and source revision.

| Evidence | Status and attribution |
| --- | --- |
| Completed integration build | Integration owner reports success at `96c7bc79` |
| Combined syntax and module linking | Integration owner reports 2,504 syntax files and 2,500 linked files passed at `96c7bc79` |
| Scope manifest assignment | Integration owner reports 617 Node and 32 browser manifest entries assigned at `96c7bc79` |
| Complete initial static gate | Not an all-pass claim: that attempt found two legitimate source/inventory hash mismatches |
| Hash correction | Reviewed in `5deb1074`, merged in `789339fe`; only exact inventory bytes/rationale changed. The affected gate result must be recorded by the integration owner |
| Complete A19/A20 Node scope | Initial combined runs completed. A20 reports no failures with explicit environment skips; A19 found failures and the owners are correcting the affected cases. Final correction-aware evidence remains pending; provisional totals are not promoted to an aggregate pass |
| Owner-focused qualifications | Retained in the linked ledgers, including original failures and affected reruns; they are not relabeled as one uninterrupted aggregate run |
| Actual browser/OS/native-editor/oracle matrix | No pass is inferred from authored fixtures, Node adapters, manifests or a successful build |
| Browser and workbench performance comparison | Requires actual captures and a reviewed compatible baseline; capture-only output is not a regression verdict |

`tests/manifests/A19.json` includes the A19 Node glob and actual workbench
browser drivers. `tests/manifests/A20.json` includes A20/editor/text cases and
the insights, language-provider and view browser drivers.
`tests/conformance/browser/project16_suites.py` registers nine explicit
workbench/editor entries with the bounded shared runner. The
`project16-qualification.yml` workflow and `scripts/project16-qualification.js`
run selected Node, browser and performance stages serially, reuse the completed
build and retain results on failure. Scheduling follows
[serial validation](../planning/qualification/serial-validation.md).

The language-provider ledger records the initial 138/141 result, the 26/26
affected correction and the final 63/63 corrective cohort. The resource ledger
retains its 72/73 run followed by the affected 6/6 save-file result. Reload and
observer ledgers similarly distinguish their real runs and fixture corrections.
These histories must remain visible when the final complete-scope result is
added; passing a later run does not turn an earlier failure into a pass.

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
