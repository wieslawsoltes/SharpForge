# Project 16 implementation and qualification map

**The supplied Project 16 snapshot contains 226 open issues: 194 distinct implementation leaves, 24 parent tasks and eight epics.** Every issue is mapped in [project16-implementation.json](project16-implementation.json). The map records source, its owning evidence and remaining qualification; it does not declare 226 completed capabilities or recommend closing an issue.

Source is pinned to committed root integration revision `40bbdea7b45ab64b24c9741046b897a35118814e` at `2026-10-04T01:26:55.971234+00:00` after the final acceptance corrections and affected retry. The JSON retains the earlier source snapshot and the SHA-256 of the supplied issue inventory. It reads every supplied issue body, including the original deliverable and task-specific acceptance. There is no #1545 in that inventory. Parent and epic entries roll up their leaves.

## How to read the status

| Leaf source state | Count | Meaning |
|---|---:|---|
| `source_present` | 135 | Source responsibilities and cited evidence exist; this is not a fully qualified or merged issue. |
| `source_present_with_limits` | 59 | Source exists with an explicit behavior, provider or qualification boundary retained from its owning ledger. |

**All 13 final acceptance-correction groups are now present in source, covering 15 distinct issue IDs.** The completed corrective cohort at `4b1c0291` ran **305 tests: 302 passed, three failed, zero skipped**. Only the three affected files were rerun at `40bbdea7`; **36/36 passed with zero skips**. Thus every one of the 305 initial corrective cases has a passing observation across the two runs. The initial run remains recorded as failed; there is no additive 341-case total or final all-in-one 305-case pass.

Historical initial stages remain separate: A19 ran 592 tests (579 passed/13 failed), its affected correction ran 83 (81 passed/two failed), and the five-case Explorer retry passed; A20 ran 610 (601 passed/zero failed/nine explicit skips). All initial A19 failures also have passing affected evidence. Final checks/builds and the separate binder measurement are not inferred from these runs. Actual browser, native desktop, OS input, assistive technology and Visual Studio oracle qualification remain open.

The JSON separates `implementation`, `evidenceLevel`, `recordedBatches`, `explicitLimits` and `remainingQualification`. Final correction entries additionally separate actual `sourceLimits` from `qualificationNotes`; the aggregate `sourceBoundaries` lists retained product/capability limits. Older mixed ledger notes are retained as provenance. All entries deliberately have `closeIssue: false`. A provider host with an explicitly requested fake-provider test is described as such; a missing production provider is never described as native or end-to-end success.

## Scope map

| Epic | Distinct leaves | Source responsibilities | Owning evidence |
|---|---:|---|---|
| [SF-A19-E01](https://github.com/wieslawsoltes/SharpForge/issues/259) | 43 | Documents, builds, app sessions, startup orchestration, preview/pinned tabs, groups, docking, command routing and output | [a19-session-evidence.md](a19-session-evidence.md); [project16-docking-coverage.md](project16-docking-coverage.md); [project16-shell-coverage.json](project16-shell-coverage.json) |
| [SF-A19-E02](https://github.com/wieslawsoltes/SharpForge/issues/260) | 26 | Per-app selectors, settings, search, shell accessibility, lazy tools, instrumentation and workflow qualification | [a19-session-evidence.md](a19-session-evidence.md); [project16-shell-coverage.json](project16-shell-coverage.json); [project16-docking-coverage.md](project16-docking-coverage.md) |
| [SF-A19-E03](https://github.com/wieslawsoltes/SharpForge/issues/551) | 17 | Error List, Output, tasks, metadata trees, Properties, Toolbox, outline, bookmarks, calls, references, Test Explorer and session tools | [project16-shell-coverage.json](project16-shell-coverage.json) |
| [SF-A19-E04](https://github.com/wieslawsoltes/SharpForge/issues/552) | 13 | Start/Options, keyboard mapping, toolbars, notifications, task/status regions, layouts, Window commands, configuration and recovery | [project16-shell-coverage.json](project16-shell-coverage.json); [project16-docking-coverage.md](project16-docking-coverage.md); [project16-text-native-evidence.md](project16-text-native-evidence.md) |
| [SF-A20-E01](https://github.com/wieslawsoltes/SharpForge/issues/273) | 36 | Persistent text buffer, operation undo, virtual view, multi-caret/box edits, Unicode/IME/bidi, folding and editor service adapters | [project16-text-native-evidence.md](project16-text-native-evidence.md); [VIEW-COVERAGE.md](../packages/editor/VIEW-COVERAGE.md); [a20-insight-coverage.json](a20-insight-coverage.json) |
| [SF-A20-E02](https://github.com/wieslawsoltes/SharpForge/issues/274) | 26 | Surround With correction, named commands, VS/Vim/VS Code/Emacs/Sublime profiles, diff/merge, accessibility and performance | [project16-text-native-evidence.md](project16-text-native-evidence.md); [VIEW-COVERAGE.md](../packages/editor/VIEW-COVERAGE.md); [a20-insight-coverage.json](a20-insight-coverage.json); [project16-docking-coverage.md](project16-docking-coverage.md) |
| [SF-A20-E03](https://github.com/wieslawsoltes/SharpForge/issues/553) | 15 | Completion, parameter/Quick Info, actions, Peek, lenses, rename, hints, navigation, diagnostics, snippets and formatting | [a20-insight-coverage.json](a20-insight-coverage.json) |
| [SF-A20-E04](https://github.com/wieslawsoltes/SharpForge/issues/554) | 18 | Overview/structure/sticky/wrap/whitespace/zoom/split views, changes/brackets/find/regex, margins, advanced edits and large files/options | [VIEW-COVERAGE.md](../packages/editor/VIEW-COVERAGE.md); [project16-text-native-evidence.md](project16-text-native-evidence.md); [a20-insight-coverage.json](a20-insight-coverage.json) |

The detailed JSON has one entry for every leaf and every parent, with exact source and test paths. Shared ownership is retained for text/view Unicode, text/insight diff, shell/keymap routing, session/docking application windows, and lazy-tool packaging. These are shared implementations, not duplicate features.

## Recorded validation

These counts are **separate, overlapping runs**. Adding them would overstate distinct coverage. The JSON catalog preserves commands, revisions, outcomes and evidence types.

| Complete scope or correction | Observed result | Boundary |
|---|---|---|
| Text/model foundation | 55 then-new cases passed at `e87dedf4`; 126 legacy cases also passed | Actual persistent-buffer, string/SourceText oracle, operation undo, bounded regex VM and exact diff/merge. Later model additions are in the current native/keymap batch. |
| Native JS commands/keymaps/block editing | Original 233: 225 passed/eight explicit skips; affected-column/keymap follow-up 261: 252 passed/nine explicit skips at `5d4b79f2` | Includes 99 VS Code shortcut fixtures, 23 visual-block cases and two exact Surround With regressions. Eight platform/unsupported skips plus one host Unicode-version oracle skip are explicit. No desktop VS Code/Vim or OS key delivery. |
| Exact Unicode and sparse visual columns | Final affected file 11 cases: ten passed, one explicit native-Intl16 skip at `e43c811e` | All 1,093 official Unicode16 GCB rows pass; existing editor fixtures agree with actual Intl17. Exact bounded reads support a 200 MiB line without source flattening. Model evidence, not UI latency. |
| Editor view | Original 57/57; final correction/configuration batch 66/66 at `66f56d88` | Synthetic input/layout plus shared-model locks, wrap/fold invalidation and actual path-based EditorConfig records. Native CJK IME, speech and browser geometry remain unrun. |
| Large-file disk seam | 172/172 | File/handle-double limits, encoding, baselines, versions and writes. A 100 MiB File decode/save functional case is not physical disk latency. |
| Prepared chunk decoder, workspace and path ownership | All 28 new cases pass at `acdf945d`; 196 distinct affected I/O cases pass across the initial and targeted-retry commands | First run: 90 passes and two setup failures from a missing local workspace package link. After repairing only the untracked link, blocked release04 and CLI ZIP checks pass 106/106. Real Node File/Blob/TextDecoder; explicit filesystem-handle doubles. |
| Insights, snippets, search, diff and formatting | 43/43 across six focused files | Production provider/worker bridge and model transactions. Actual rendered widgets and browser worker execution remain unrun. |
| Sessions and launch | Foundation 48/48; real launch boundary 139/139 at `370a7dfb` | Source VM and direct CIL actually execute argv/environment through real workers; no native CLR/Wasm or browser WinUI claim. |
| Session recovery/runtime tools | 253 ran: 252 passed, one selector reentrancy failure; fixed affected file then 3/3 at `ad62b560` | The failed handler captured a value after synchronous re-render. Capture-before-notify fixed it. The other 250 cases had passed and were unchanged; no claim of an all-253 rerun after the fix. |
| Prepared DocumentService and captured source saves | 67/67, zero failures/skips at `cc578eb2` | Public source-reader adoption, shared model ownership, unmaterialized snapshots through edits/save races, recovery and removed-project profile cleanup. Later root Node fixtures exercise the actual Studio loader/Save As callbacks; browser permissions and artifact delivery remain unqualified. |
| Captured large-source Save As | 24/24 at `fe2c20f7` | A 200 MiB ASCII persistent snapshot streams 3,200 writes, every byte verified, with bounded reads and no whole-text cache. Cancellation/encoding/BOM/capture/close/abort/download outcomes are covered through handle doubles. The 6.296-second functional fixture is not browser interaction latency or physical disk throughput. |
| App inspector and multi-session runtime fixture | 7/7 inspector boundary cases; 2/2 actual source/direct-CIL fixture cases | Actual Studio two-window browser driver is authored and unrun. |
| Docking/document groups | Initial 53 passed; combined docking/performance follow-up 33 passed | Tab/dirty-close/model/schema/history evidence; pointer/popout/browser paths require the authored browser fixture. |
| Shared Studio navigation adapter | 12/12 at `e65625ac` (five new, seven existing) | Actual view/group/popout capture, nested activation, failed-open guard, replay/menu/clear/dispose. Root toolbar/dropdown wiring is separately unqualified. |
| Independent Watch windows | 7/7 at `35b7bad0` | Actual registered commands and restore factory; per-window application target, expressions/results, stale-frame cancellation, hidden-window suspension, retained DOM controls, persistence and disposal. Controlled sessions and synthetic DOM; actual Studio browser flow unrun. |
| Shell and theme migration | 74/74 at `d5b1d153`: 70 shell cases and four shared stylesheet contract cases | Final nine-file cohort; all 54 leaf ledger entries reconciled at `7a6ad9b8`. The 350-token gate preserves 955 paint and 2,421 other declarations. Real browser contrast/forced-colors/native DPI remain unrun. |
| Lazy features and standalone graph | 26 combined focused checks; normal and standalone builds passed at `251f826b` | Closed literal dynamic imports and four actual bundled worker graphs, CSP preserved. First activation offline and startup-evaluation improvement require browser measurements. |
| Editor performance harness | 11 harness checks; real four-size model/GC baselines; self-gate pass and deliberate 21% regression rejected | No browser latency baseline. New explicit 200 MiB option/readiness scope passed 3/3 without allocating or measuring that file. |
| Analysis and native TaskCenter adapters | 32/32 at `bf3988f6`; separate native callback/disposal integration 9/9 at `2c752af0` | Actual service events and real MSBuildClient with controlled HTTP responses. No native SDK/process or browser run. |
| Real Test Explorer CodeLens | 29/29 at `6bbb1dca`, 14 new | Current source/project ownership, actual selected provider execution and status events; later semantic/widget follow-up is qualified separately. |
| Horizontal/vertical host split and Vim filenames | 23/23 at `58f5ef57`, 9 new | Exact actual layout trees, shared models/undo/view states, workspace opener and failure boundaries; browser geometry remains unrun. |
| ReSharper-like and first-run schemes | 27 new cases pass; 48 distinct eventual cases after one exact legacy Emacs binding expectation fix | Real JS editor model, settings and global resolver; no OS/browser/JetBrains execution. |
| Explorer snapshot/source saves | 42 initial passes plus three public-export module-load failures; affected files then 34/34 at `a03baa34` | 76 distinct eventual passes, 21 new, including 17 MiB sliced source and DocumentService-to-DiskWorkspace encoding; controlled handles. |
| Atomic text/resource/project-XML rename | 73 distinct eventual passes: 72 initial and corrected save dependency file 6/6 | Nine new host-transaction cases pass. Native resource moves remain explicitly unsupported without an atomic host capability. |
| Cooperative normalization and encoded save | 163 distinct eventual passes, 41 new: 162-case run 161 pass/one genuine selection bug, corrected subset 30/30 | Actual 200 MiB Node model/output fixtures; no browser or physical-disk p95. |
| Semantic providers and pure Outline planner | Initial 141-case batch: 138 pass, three genuine failures; affected follow-ups 26/26 and 63/63 at `ee32eebc` | All initial failures are covered. No 141-case rerun or sum of overlapping cohorts is claimed. Actual browser/native/Visual Studio qualification remains unrun. |
| Fixed lazy-import security inventory | Review 04 full static gate: 2,299 files/modules, zero errors at `eec21669`; integrated moved-metadata scope: seven files, 29 sites, zero errors at `14019d1c` | Exact bytes, counts and source-specific reasons; scanner/linker/CI rules unchanged. Full integration core and runtime/browser behavior are not inferred. |
| Current-target disk observation and reload | 79/79 at `6d70fa30`, 36 new, 2.803 s; atomic document reload separately reached 28 distinct eventual passes after two fixture corrections | Actual temporary native filesystem/hash/UTF-8/UTF-16 paths; browser FileSystemAccess handles remain doubles. Root callback wiring and actual browser prompt/permission behavior are separate. |
| Final shared-metadata import inventory | Source-only audit `68017508`: three hashes reviewed plus the fixed public bytecode metadata import | Six current workbench files, thirty literal sites; no repeated gate/test/build. Consolidated root gate remains pending. |
| Clean integrated build and static stages | Normal build passed at `96c7bc79`; manifests 617 test files/32 scripts, syntax 2,504 files and linker 2,500 modules had zero respective errors | Full static check failed only two exact-byte inventory files. `5deb1074` and final intrinsic review `fc9d28c8` supply the reviewed corrections; affected gate pending. |
| Shell metadata, Outline and execution capture | Initial 136: 134 pass/two fail; affected 14: 13 pass/one fail; final metadata 12/12. 140 distinct observed names; no additive 162 total | All observed provider failures corrected. Final graph and sparse-enumeration assertions also pass in root scope. Actual browser delivery remains unqualified. |
| Matched worker instrumentation benchmark | Nine recorded samples per variant after three warmups; source p95 −15.33%, direct-CIL p95 +1.63% at `3b3f6546` | Shared-host observations with actual source/direct-CIL pumps; no speedup, native OS CPU, allocation or less-than-one-percent overhead verdict. |
| Complete A19/A20 Node stages | A19: 592 tests, 579 passed/13 failed, 28.090 s; affected 83 tests, 81 passed/two failed; final Explorer 5/5. A20: 610 tests, 601 passed/zero failed/nine skipped, 31.390 s | Every initial A19 failure now has a passing affected case. Eight A20 skips are explicitly unsupported targets, and one is an unavailable pinned native Intl oracle. No overlapping sum or repeated full run. |
| Final 13 acceptance-correction groups | Initial 305 tests:302 passed/3 failed/0 skipped at `4b1c0291`; affected 36/36 at `40bbdea7` | All 305 distinct corrective cases have passing observations across the two runs. Two stale assertions and one real capture-listener cleanup bug were corrected; no 341 sum or final 305-case rerun. All 16 new host and 19 new provider cases passed in the initial cohort. |

Full matrix scheduling follows the current contribution policy: complete scope first, then serial/resource-limited qualification. The documentation aggregation did not run tests or builds. Independently assigned navigation, Watch, task/native, CodeLens and split source batches were completed before their recorded focused checks. The import-inventory correction ran only the affected static policy scope.

## Actual measurements

The committed [model baseline](performance/editor-model-baseline.json) and [retained-memory baseline](performance/editor-memory-baseline.json) use the actual `TextBuffer`, `EditorModel`, undo, token index and visual-row map. They ran sequentially on Node v24.19.0 / V8 13.6.233.17-node.51, Linux x64, AMD EPYC 9V74, with nine logical CPUs visible. The machine was shared by agents. Product dependencies were at `9b51d3dd`; the benchmark source was present before its own commit. There are 20 retained samples, three warmups and one separate cold sample per operation/size. At that sample count p99 is the observed maximum.

| 100 MiB model operation | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|
| `model.edit` | 0.0111 | 0.0224 | 0.0456 |
| `model.paste64KiB` | 0.3809 | 0.4949 | 0.8826 |
| `model.undo64KiB` | 0.0074 | 0.0159 | 0.0479 |
| `model.findLiteral` | 1298.3148 | 1407.1132 | 1419.2181 |
| `model.viewportQuery60Lines` | 0.0334 | 0.0410 | 0.0717 |

These numbers exclude browser events and paint. In particular, the roughly 1.4-second synchronous full find is **not evidence of interactive responsiveness**. The independent cooperative-search artifact records an exact trailing-marker search on a real 100 MiB model with yields; it is a different workload, also measured in Node. No speedup is computed between them.

The independent [visual-column artifact](../packages/text/bench/visual-columns-results.json) measures 30 lookups on a one-MiB line. Full-prefix scanning had median 61.508594 ms and p95 68.025205 ms; the already-indexed sparse lookup had median 0.129756 ms and p95 0.265230 ms. The first cooperative lookup took 25.040206 ms with 15 yields. This compares cold/full scanning with cached indexed lookup explicitly; it does not imply the first browser lookup fits a frame budget.

At 100 MiB, retained source/buffer storage was about 110.006 MiB, the shared model 4,776 bytes, undo 748.4 bytes per explicit step and the visual-row index about 15.001 MiB. Token retention was 3,384 bytes because that size uses the declared plain-text fallback; it is not full semantic highlighting. At 1 MiB the actual compiler token index retained about 24.982 MiB. All predeclared structural budgets passed. These are signed GC-retained heap/ArrayBuffer deltas, not total allocation counts or browser/native memory.

The comparison CLI rejects any per-size/per-operation p95 regression greater than 20%, validates raw samples and environment identity, and rejects missing required data. A deliberate 21% report exited with failure. CI still needs a reviewed baseline measured on compatible fixed hardware; the committed shared-host Node baseline cannot become a different runner’s browser baseline.

## Concrete source audit and remaining integration qualification

| Issue(s) | Source finding and current state |
|---|---|
| [#1539](https://github.com/wieslawsoltes/SharpForge/issues/1539) | Read-only audit found two histories: Studio populated the old URI-only history while window capture shortcuts called an empty workbench history. The tested `StudioNavigation` adapter unifies the service; root now contains the shared route and actual dropdown. Integrated UI verification remains pending. |
| [#1533](https://github.com/wieslawsoltes/SharpForge/issues/1533), [#1568](https://github.com/wieslawsoltes/SharpForge/issues/1568) | Search emitted `preview:true` while the old root adapter discarded it. Root now supplies `studio-open-location.js`; the actual five-file definition/Go To All preview flow remains unqualified. |
| [#1566](https://github.com/wieslawsoltes/SharpForge/issues/1566) | The initial token-only implementation left literal legacy colors. The completed shell migration adds 350 tokens and a literal gate, with 74/74 final shell/style tests. Browser contrast, forced-colors and DPI remain unqualified. |
| [#1513](https://github.com/wieslawsoltes/SharpForge/issues/1513), [#1517](https://github.com/wieslawsoltes/SharpForge/issues/1517) | Chunk decoding, prepared adoption, snapshot saves and path rebasing now have complete focused evidence. Root contains actual source-import/workspace-loader and captured-save adapters with passing affected Node evidence; final browser/artifact qualification remains open. A size-option or Node File test does not prove a 200 MiB file opens, scrolls and edits under 50 ms p95 in a browser. |
| [#1479](https://github.com/wieslawsoltes/SharpForge/issues/1479) | The exact two-case chord regression now verifies Surround With once, actual snippet insertion/one undo, zero code-actions/host calls and unchanged history when the provider is absent. Both pass; real browser picker and key delivery remain unrun. |
| [#1547](https://github.com/wieslawsoltes/SharpForge/issues/1547) | The initial generic factory did not expose actual Watch2. Registered Watch1–4 commands now create independent application-aware controllers, with persisted expressions/target and factory registration before restore. All seven focused cases pass; the actual multi-app browser workflow remains unqualified. |

The audit assigned the concrete missing provider behavior to its owners. Test-status CodeLens, the ReSharper-like first-run scheme, Fix All, type/comment/string/file rename, parameter-name hints, Class View metadata, reference classification, referenced-assembly/core-intrinsic metadata, actual Outline host and worker execution occupancy now have source and focused evidence. The final graph interval and sparse metadata enumeration assertions also pass in the root scope. Initial failures and overlapping corrections are retained; actual browser/native/Visual Studio acceptance is still separate.

Other bounded contracts remain explicit. Built-in replacement/preview plans cap edited document text at 32,000,000 UTF-16 units; Find remains independent. Safe regex can report `SEARCH_LIMIT`; automatic polling/reload/comment scanning uses an eight-million UTF-16 unit limit with a notice, while root workspace recovery has an eight-MiB character budget; actual Test Explorer adapters are external to the fake-provider host acceptance. The eight native-keymap skips are documented unsupported shell/Vimscript/terminal/regex-extension/OS-primary-selection/unbounded-macro targets and unrun desktop/browser/assistive qualification. The latest column cohort adds one explicit native Unicode16 oracle skip because the host uses Unicode17; the independent pinned Unicode16 conformance rows pass. Skipped targets are not counted as passing tests.

## Final acceptance corrections and remaining source limits

The following **13 correction groups cover 15 distinct leaves**. Their actual source and test paths are appended to those
leaves in the JSON. The completed cohort includes the new correction fixtures and their affected regressions. The three
registry/composition/reveal failures are resolved by the affected retry. The original failure records remain available
in [the qualification history](project16-qualification-history.json) and the exact
[initial log](evidence/project16-integration/p16-correction-cohort.log) and
[retry log](evidence/project16-integration/p16-correction-retry.log).

| Correction group | Issue(s) | Completed behavior and owning evidence |
| --- | --- | --- |
| Origin-based next occurrence | #1600 | Indexed single-match lookup starts after the actual selection, bypasses capped prefix results and preserves exclusions/capacity; [text evidence](project16-text-native-evidence.md). |
| Incremental search | #1507 | Actual widget retains origin, direction, wrap, cancellation and model/session ownership; [text evidence](project16-text-native-evidence.md). |
| Surround With | #1494 | Production picker preserves selected line endings and contextual visual indentation; [snippet/edit contract](../packages/editor/docs/surround-and-tab-conversion.md). |
| Tabify/Untabify | #1510 | Every logical line resets visual columns while all CR/LF/CRLF terminators survive; [snippet/edit contract](../packages/editor/docs/surround-and-tab-conversion.md). |
| Call Hierarchy | #1458 | Public shell command, worker and lazy model preserve actual project and source identity through expansion/navigation; [provider evidence](a20-provider-acceptance-corrections.md). |
| Method completion | #1482 | Actual C# method items supply the opening-parenthesis commit character and retain widget/undo/read-only behavior; [provider evidence](a20-provider-acceptance-corrections.md). |
| Parameter information | #1483 | Bound receiver/accessibility/overload/generic invocation candidates drive signature information; [provider evidence](a20-provider-acceptance-corrections.md). |
| Startup and instance menus | #1526, #1530 | Actual menu registry reaches startup/instance commands with explicit project context and current availability; [Studio contract](project16-studio-composition.md). |
| Captured reveals | #1556 | Runtime/build/launch navigation retains initiating intent and app generation; capture listeners dispose correctly; [Studio contract](project16-studio-composition.md). |
| Startup profile preservation | #1529, #1531 | Legacy Explorer and toolbar startup selection preserve the intended project's selected profile; [Studio contract](project16-studio-composition.md). |
| Diagnostic producers | #1555 | Real project/designer warnings and errors reach the shared store/Error List with exact ownership and invalidation; [host evidence](a19-host-producers.md). |
| Explorer project rows | #1557 | Startup/build/running/paused badges, accessible names and real subscriptions/disposal are connected; [host evidence](a19-host-producers.md). |
| Build Cancel | #1558 | Actual TaskCenter cancellation stops its complete captured queue while preserving independent or later work; [host evidence](a19-host-producers.md). |

**Confirmed remaining unimplemented primary source-acceptance issue IDs in these known records: none.** This statement
reconciles the existing coverage maps and correction documents; it is not a new broad source audit or a claim that every
acceptance criterion is qualified. Every issue remains open for review/qualification in this map. Actual platform behavior,
measured thresholds and completed CI outcomes still need their own evidence.

The following are retained source/capability limits, rather than unrun tests:

| Issue(s) | Retained product boundary |
| --- | --- |
| #1454, #1456, #1458, #1483, #1485, #1487, #1489 | Registered writers/bound providers define the surface; unsafe reorders are rejected, unavailable external relationships/tips are not fabricated, and Fix All/test lenses/hints require valid implemented families and current ownership. |
| #1461 | The Test Explorer implements the requested provider host and fake-provider acceptance; a built-in xUnit/NUnit/MSTest adapter is absent. |
| #1462, #1471 | CPU activity measures managed worker execution occupancy. Analysis cancellation suppresses an owned request's late reply but does not interrupt synchronous work already executing in the shared compiler worker. |
| #1464, #1477, #1506, #1507, #1600 | Content scanning, automatic reload, replacement previews, search work and selection count retain documented bounds. Safe regex/navigation report budget exhaustion explicitly; larger-file explicit chunked opening is separate. |
| #1488, #1529, #1530 | Generated/metadata sources remain read-only; native atomic resource rename and native start-instance are not advertised. Launch argv/environment execute on source VM/direct CIL with explicit unsupported-target refusal. |
| #1493, #1496 | Regex snippet transforms are rejected. Documentation comments provide a generic summary template; symbol-specific parameter/return tags require a provider. Those extensions are not named in the primary acceptance assertions. |
| #1623 | Native Vim explicitly excludes shell/external filters, Vimscript/plugins, terminal buffers, Vim-specific regex extensions, OS primary selection and unbounded recursive macros; unsupported-target reporting is part of its requested contract. |

Browser/native/OS/oracle gaps in the next table are **qualification gaps**, not additional source implementations or passing
results. In particular #1513's actual 200 MiB/p95 requirement, #1578's overhead threshold, #1580's measured startup/offline
first use, #1581's compatible-runner performance verdict, and #1577/#1583's actual browser results remain unestablished.

## Remaining qualification

| Required evidence | Current state |
|---|---|
| Final root checks and complete scope | Earlier stage results are preserved in the qualification history. Final 13-source-correction cohort:305/302/3/0 skips; affected retry 36/36/0 skips. All 305 distinct corrective cases have passing observations, without a 341sum or final 305-case rerun. Required final statics/builds and separate measurements remain pending at this snapshot; platform acceptance is not inferred. |
| Actual static and standalone Studio/editor browser scenarios | Authored production/CSP-aware drivers, unrun. The supported Playwright installation exhausted unusable browser-download attempts; no placeholder browser artifact exists. |
| Chromium, Firefox, WebKit and browser workers | Unrun; actual engine/version and unsupported targets must be recorded. |
| 200 MiB load/scroll/type p95, map frame budget, 300 ms definition update, instrumentation overhead below 1%, cold lazy evaluation and workbench baseline | Unmeasured in an actual browser. Node model/test durations cannot satisfy these thresholds. |
| Native CJK IME, physical keyboard/touch/pen, cross-application clipboard and browser disk permissions | Actual platform input/permission behavior remains unrun. The observer cohort separately exercises real Node temporary filesystem/hash/read/write routes; it does not qualify cross-platform physical-I/O latency or browser permission dialogs. |
| Screen readers, speech transcript, high contrast/zoom/focus and complete accessibility rules | Unrun on actual assistive technology; browser fixtures and semantic controls alone are not certification. |
| Versioned desktop Visual Studio/VS Code/Vim oracle | No executable or pixel-parity pass. Pinned inventories and exact modeled shortcut results remain separately identified. |

Reviewers can follow each issue’s source and owning ledger without opening another tracking system. Before closing an issue, reconcile its concrete source gaps, run its affected qualification on the final merged stack, and attach the actual commands, versions and artifacts. An epic closes only after every leaf has its own merged evidence; it contributes no extra delivered-capability count.


## Later completed source batches

The [background task contract](a19-background-task-bridge.md), [native client lifecycle](a19-native-task-integration.md), [Test CodeLens contract](a20-test-code-lens.md) and [host split correction](a19-editor-host-splits.md) record exact source and focused results. The [resource rename contract](a19-resource-rename.md) and updated editor coverage ledger preserve their genuine initial failures and narrow corrected reruns. These later results overlap historical cohorts and must not be summed.
