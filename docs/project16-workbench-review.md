# Project 16 review 04: docking, windows, commands and shell

This review layer is `codex/project16/04-workbench-shell`, stacked on
`codex/project16/03-sessions-runtime` at
`da59654f10079ecb4326d919ddbdf5e0bed92e67`. It also depends transitively on the
editor public API in review 02. The branch assembles already qualified source
batches, their focused tests and their explicit host adapters. Studio bootstrap
composition is a later review layer.

## Source provenance

The branch preserves the clean docking history through merge of
`af4535e82b72360888bb236578b5cafaea99ceef` and the original shell sequence through
merge of `b0c5868b73622056b429e7008c64301e6e0811b4`. Neither closure brings in the
integration branch's Studio bootstrap changes. Follow-up files were copied only
from committed source snapshots:

| Source | Included work |
| --- | --- |
| `35b7bad0738ee73276120a9645fda9592ecec552` | Final docking model/host, preview and dirty tab policies, background-open focus preservation, shared navigation, lazy controller adapters, keyboard adapter, independent persisted Watch windows and their tests |
| `7a6ad9b8310f55f275d87e2a8eda76d42a8719c6` | Contextual command registry, shell models and tool factories, options, search, notifications, recent workspaces, status, theme migration, tests and 54-leaf shell ledger |
| This review layer | Docking stylesheet build contribution, packaged external-CSS example, production-CSP docking browser fixture, aggregate stylesheet fingerprint and scoped manifest |

No source was taken from uncommitted files. The branch makes no changes to
`apps/studio/studio.js`, compiler/runtime packages, text/editor packages, or the
session and project service implementation already in review 03. Prepared source
ingress, captured saves, pending Explorer changes and the new visual-column index
are outside this layer.

The status adapter can consume an optional cancellable visual-column provider;
its bounded fallback works with the inherited public text/model API. Including
that adapter does not imply inclusion or qualification of the later text index.

## Behavior included

The docking package supplies explicit drop guides, nested floating groups,
auto-hide flyouts and resizing, same-origin popouts with retained DOM identity,
keyboard window management, schema migration, undoable layouts and diagnostics
for invalid persisted state. Document tabs add one preview per group, pinning,
promotion on edits, MRU navigation, shared secondary views, and atomic
Save/Discard/Cancel preflight. Unchanged dirty metadata avoids host redraws, and
background source synchronization preserves the selected secondary editor,
Application window or tool.

The shell registers contextual commands, menu and toolbar controls, user and
workspace preferences, theme settings, keyboard overrides, dialogs,
notifications, background tasks, recent files/workspaces, scoped search and
replace previews. Tool factories cover Error List, Output, Task List, Class View,
Object Browser, Properties, Toolbox, Outline, Bookmarks, Call Hierarchy, Code
Definition, references, Test Explorer, session diagnostics, Command Window and
additional Solution Explorer views. Independent Watch 1–4 windows persist their
own expressions, select or pin an application, reject stale session results and
dispose their own subscriptions.

Designer, Assembly Explorer, Disassembly, MSBuild and Project Wizard controller
factories are deferred until actual use. Explicit facades preserve their
rendering and automation return contracts. Disposal cancels pending activation;
retry does not duplicate successful controllers. The extracted designer and
native configuration adapters still require the host callbacks listed below.

The theme migration centralizes legacy palette values while retaining the
recorded declaration order and geometry. The immutable migration proof records
955 paint and 2,421 other declarations across 26 original files. Its content is
unchanged from the owner's qualified source.

### Package/build corrections

Studio's legacy stylesheet contains the base docking host, while the new guides,
flyout grips, tab states and window dialogs live in
`packages/docking/src/host/workbench.css`. The package now contributes that
existing stylesheet at order 1999, before the editor styles at 2000 and the later
Studio theme overrides. Its standalone `src/style.css` continues to import both
base and workbench styles.

The docking package includes its runnable examples in the distributed file set.
The example uses external JavaScript and CSS. The independent docking browser
fixture uses the shared production server and CSP against built package assets;
its original behavior assertions remain. The shared fixture helper gained an
optional package-example argument and preserves the existing editor fixture API.

The aggregate A00 stylesheet fingerprint was generated statically from commit
`6b44816b792a13aa3b6f5927d506a68105419f64`: 41 contributed styles, 214,812 bytes and
1,638 rules. The change includes the docking workbench stylesheet and the
semantic field/event/namespace rules already present in review 02. This is a
composed-source fingerprint, not a new test result. The independent legacy
declaration proof remains unchanged.

## Host contracts for the following composition layer

| Adapter | Required host wiring and ownership |
| --- | --- |
| `StudioDocking` | Construct with a retained document factory and activation/close callbacks; call `attachDocuments` with review 03's `DocumentService` before synchronizing sources; route keyboard and popout document hooks to the shared keyboard service |
| `installWatchWindows` | Supply the same `sessions`, command registry, docking instance and scoped storage; install before the first `docking.sync` so persisted tool identities resolve; dispose with the owning workspace |
| `WorkbenchShell` | Supply document/output/diagnostic/session/build services, one command registry, compiler requests and navigation; mount menu/toolbar/status hosts; route visible tool rendering and source/session changes through the shell; dispose subscriptions and mounted controls |
| `StudioKeyboard` | Supply the active editor accessor and command context; attach every editor and main/popout document; apply profile changes and overrides atomically; dispose editor and DOM registrations |
| `StudioNavigation` | Pair each host file jump with `beforeOpen` and `afterJump` in `finally`; pass `record:false` on failure; share the same navigation instance between toolbar, menu and keyboard commands |
| `createStudioLazyFeatures` | Supply compiler/runtime clients, document and workspace operations, source edits, native state, tool rendering and status callbacks; install the returned facades in the existing host operations and invoke their teardown |
| Recent/settings/search | Register permission-bearing recent-workspace sources, transactional workspace edits, disk reads/reload, settings application and per-project configuration callbacks; no callback is inferred from a global singleton |
| Tool-specific providers | Supply metadata inspection, definition source, semantic hierarchy/reference data, typed property writers, designer operations and registered test providers as appropriate; unavailable operations remain explicit |

The source dependency audit found no missing static imports or named exports.
The remaining composition work is invocation and ownership of these contracts,
not a missing package dependency. No new runtime dependency is introduced.

Some acceptance behaviors still need implementation in dependent semantic or
tool batches: external referenced-assembly browsing, safe code Outline reorder,
session CPU graphs, ReSharper-like scheme selection, compiler read/write
reference classification and class inheritance metadata, Fix All scopes, test
status CodeLens, richer rename and parameter-name hints. These are implementation
gaps, distinct from browser or external-oracle qualification. The source ledgers
retain those limits; this review does not mark the corresponding issues closed.

## Scope evidence and manifest

Historical completed-source validation:

| Cohort | Reported result and boundary |
| --- | --- |
| Original docking batch | 53 focused cases passed; later nine-tab cohort includes the unchanged-metadata regression |
| Navigation follow-up | 12/12 across five new Studio navigation cases and seven existing window/navigation cases |
| Independent Watch windows | 7/7 focused cases at `35b7bad0` |
| Lazy activation and focus synchronization | 12/12 focused controller/model cases; constructors are injected in the lazy factory fixtures |
| Shell and styles | 74/74 at `d5b1d153`: 70 shell cases plus four shared A00 stylesheet contract cases |

These cohorts overlap and must not be added together. Their source owners ran
them after completing their scopes. The broader 26-case standalone/lazy/build
qualification mentioned in the historical docking ledger includes packaging
changes outside this review layer and is not claimed as review 04 coverage.

No tests, browser suites, builds, benchmarks or native/Visual Studio oracles were
rerun while assembling this branch. Static inspection parsed and linked 137
entry files through 693 modules, including 17 docking modules and 114 workbench
modules, with zero evaluated project modules. The docking Python fixture and
shared fixture helper parse successfully. All A19 manifest paths are present and
have one owning manifest; the working diff has no whitespace errors.

The A19 manifest contains 35 Node files: the 19 inherited from review 03 plus
these 16 scoped files:

```text
tests/a19-03-document-tabs.test.js
tests/a19-04-docking-model.test.js
tests/a19-shell-boundaries.test.js
tests/a19-shell-commands.test.js
tests/a19-shell-inventory.test.js
tests/a19-shell-recents.test.js
tests/a19-shell-search.test.js
tests/a19-shell-settings.test.js
tests/a19-shell-themes.test.js
tests/a19-shell-tools.test.js
tests/a19-studio-docking-sync.test.js
tests/a19-studio-keyboard.test.js
tests/a19-studio-lazy-features.test.js
tests/a19-studio-navigation.test.js
tests/a19-watch-windows.test.js
tests/a19-window-layouts-navigation.test.js
```

`tests/a00-20-styles.test.js` keeps its existing A00 ownership. The A19 browser
manifest retains `tests/browser_test.py` and adds the independent
`tests/browser_a19_docking_test.py`. Neither browser suite is claimed as run.

The actual Studio shell, first-use and performance browser drivers require the
following composition layer and are intentionally absent here. Their original
sources and scenario mappings remain identified in
`docs/project16-shell-coverage.json`, `docs/project16-docking-coverage.md` and
`docs/vs-workflow-matrix.md`. The shell ledger's `reviewSlice` distinguishes the
102 included owned paths from its four deferred workflow/performance paths.

## Reviewed lazy-import inventory

The required static gate on review 04 found thirty unrecorded literal import
sites in six workbench files. This follow-up reviews the source at `1ec96cea`
against the exact-byte policy in `planning/qualification/threat-model.md` and
records each file hash, operation count and source-specific rationale in
`scripts/conformance/static/allowlist.json`.

| Source under `apps/studio/workbench/` | Sites | Reviewed destinations and use |
| --- | ---: | --- |
| `comment-tasks.js` | 1 | Public `@sharpforge/syntax` entry for comment-trivia lexing |
| `lazy-tools.js` | 5 | Fixed adjacent Designer, Assembly Explorer, Disassembly, MSBuild and Project Wizard controllers |
| `shell-models.js` | 2 | Public editor and designer entries for bundled snippets and control metadata |
| `shell-tools.js` | 20 | Literal relative imports from a closed tool-ID map into the adjacent `tools/` directory |
| `tools/code-definition.js` | 1 | Public framework entry for read-only registered contract metadata |
| `tools/object-browser.js` | 1 | Public framework entry for registered types, contracts, properties and events |

All destinations are checked-in modules. Tool and instance identifiers select
existing loader callbacks; source text, snippet contents, framework lookup names
and inspected assemblies never form a module specifier. The browser build
rewrites the four public package names to bundled same-origin module URLs, and
the relative imports retain fixed same-origin targets. These sites use ordinary
module loading permitted by the shipped CSP and introduce no JavaScript source
evaluation or script-element injection.

The scanner, linker, CI workflow, rejection rules and existing policy entries
are unchanged. Any later source-byte or import-count change invalidates these
entries and requires a new review. This source audit does not claim browser
enforcement or standalone artifact qualification; those remain separately
scheduled for the exact assembled application and its packaging layer.

After completing the inventory correction, the affected gate passed with 2,299
inspected files, 2,299 linked modules and zero errors:

```text
node scripts/limited.js node scripts/conformance/static/check-imports.js --output /tmp/project16-review04-static-imports.json
```

No runtime tests, builds, browser suites or native/oracle checks were rerun for
this inventory-only correction. The earlier scope evidence remains unchanged.
