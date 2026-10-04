# Visual Studio workflow qualification matrix

This inventory separates public APIs, observable behavior and visual qualification.
It is a capability record for SharpForge Studio, not a claim of complete Visual Studio
compatibility. Browser restrictions and unavailable workspace providers remain visible
in the UI.

## Version and evidence

The A19 implementation is tracked by Project 16 and issues SF-A19-T05, T08–T42.
The source revisions and final validation commands are recorded in the integration PR.
The audit baseline is `011f2bc3bdd84f8db82a928d117100017211ca78`. The implementation
reuses the current shared controls CommandRegistry, TreeModel and TreeView, the
compiler worker language requests, framework contract metadata, and independent
document, build and app-session services.

| Workflow | Public contract / host | Behavior evidence | Visual and platform status |
|---|---|---|---|
| Create and open projects | Existing project wizard, File commands, Start window | Existing `browser_workspace_test.py` and `browser_release11_test.py`; new Start host integration | Existing browser workflow; new shell integration requires browser execution |
| Edit and save source | DocumentService, active editor and save provider | Document service and editor suites; shell delegates edits and saves | Browser editor qualification belongs to A20; native editor not implemented |
| Command routing | Shared controls registry with contextual descriptions and aliases | `a19-shell-commands.test.js` checks menu/palette/Command Window shared enablement | `browser_a19_shell_test.py` checks live menu and keyboard host |
| Multi-project build | Per-project BuildServices, solution configuration mapping | Session service tests; `a19-shell-settings.test.js` checks selected Release mappings | Real CLR/native MSBuild qualification is separate; no simulator is native evidence |
| Debug and app sessions | SessionManager, app windows, Debug Location, Processes | Session agent suite and existing browser debugger suites | Session timelines report actual worker events; CPU usage is unavailable unless a provider reports it |
| Code and designer navigation | Symbol requests, outline, Class View, Code Definition, bookmarks | `a19-shell-tools.test.js`, `a19-shell-search.test.js` | Metadata-as-source covers registered framework contracts; external unresolved definitions remain explicit |
| Find and replace | Worker search, exact UTF-16 spans, versioned result windows, per-document edits | `a19-shell-search.test.js` checks cancellation, stale results, selected replacement and limits | Regex requires an interruptible worker; no main-thread regex fallback |
| Error List | Source, severity, scope, sorting, copy and column model | 5,000-diagnostic fixture in `a19-shell-search.test.js` | Live grid browser checks required for pixel/DPI claims |
| Output | Bounded lines, pane/scope selectors, parsed file links, virtual grid | 100,000-line fixture and link tests in `a19-shell-search.test.js` | Browser scrolling is independently tested; line retention is bounded by OutputChannels |
| Test | Test provider contract and Test Explorer host | Fake-provider host acceptance tests in `a19-shell-tools.test.js` | No built-in xUnit/NUnit/MSTest runner is claimed; unregistered provider is shown in UI |
| Design | Existing DesignDocument and DesignerTools; Toolbox/Properties/Outline adapters | Existing `browser_release12_test.py`; shell provider selection and tree tests | No pixel-parity claim; code reorder requires a semantic provider and is rejected otherwise |
| Settings | Versioned schema, user/workspace overrides, atomic Options transaction, import preview | `a19-shell-settings.test.js` covers migration, corrupt settings, quotas and secret exclusion | All shell themes support tokens and forced colors; unrelated legacy styles retain their own rules |
| Recovery and external edits | FileWatch with explicit disk reader, reload callback, compare and recovery store | `a19-shell-settings.test.js` checks once-per-version notification and bounded drops | Browser polling works only for supplied authorized handles; no operating-system watcher is claimed |
| Publish/export | Existing DLL/project/archive export commands | Existing export browser suites | No new hosting or native installer pipeline is introduced by A19 |
| Source control | Existing external Git workflow; no in-browser Git provider | Not implemented in this shell | Explicit gap: repository status/staging/commit UI needs a Git provider |

## Performance contract

`WorkbenchPerformance` records actual startup composition, command execution,
navigation and tool activation durations in milliseconds. Traces identify session,
cold activation, p50, p95 and p99. Storage is bounded. A disabled trace performs a
single branch at `start` and no record allocation. No heap-allocation or sub-1%
overhead claim is made without measurement on the integrated browser build.

`ToolRenderScheduler` marks hidden tools dirty without scheduling a frame. The
regression test sends 10,000 output invalidations while the panel is hidden and
requires zero scheduled callbacks and zero render calls. Visible grids create DOM
only for the viewport plus overscan. Diagnostic sorting is O(n log n); filtering,
search result grouping, bookmark adjustment and symbol grouping are linear in the
input or selected result set. Search workers have a 5-second default hard timeout,
100,000 result limit, 100-million UTF-16-unit input limit and explicit cancellation.

## Reproducible commands

Run the complete shell scope before pushing its PR stack:

```sh
node --test tests/a19-shell-commands.test.js tests/a19-shell-settings.test.js tests/a19-shell-search.test.js tests/a19-shell-tools.test.js
npm run check
npm run check:structure
python tests/browser_a19_shell_test.py
python tests/browser_vs_workflows_test.py
node scripts/benchmark-workbench.js
```

The browser command must run against both static and standalone output through the
repository browser harness before either target is marked qualified. Unit fixtures
do not qualify rendering, native process integration, device DPI, screen-reader
behavior or pixel parity.

The native keyboard Options follow-up consumes public `KeybindingService` and
`eventStroke` exports from the editor workstream. Run its focused settings and
boundary suites after integrating those exports. `project16-shell-coverage.json`
maps each of the 54 assigned leaf issues to source, tests, qualification state and
specific remaining acceptance limits.

The large-workspace driver creates one real project with 501 C# source files,
opens 20 documents and activates five real tools. Its output includes measured
p50, p95 and p99. Set `SHARPFORGE_WORKBENCH_BASELINE` to a previously qualified
trace to enforce the 20-percent relative p95 regression gate. Absolute startup,
document-switch and tool-activation limits also apply. The separate comparator
`node tests/workbench-perf-budget.mjs current.json baseline.json` checks captured
traces without launching another browser. No browser timing is claimed until the
integrated static and standalone drivers actually run.

## Embedding example

```js
import {createWorkbenchShell} from './workbench/shell.js';

const shell = createWorkbenchShell({
  document,
  root: document.querySelector('#app'),
  state: () => state,
  commands: commandRegistry,
  keybindings,
  services: workbenchServices,
  requestCompiler,
  navigate: location => openFileAtLocation(location),
  getEditor: () => activeEditor,
  designer: () => designerTools,
  docking,
  applyEdits: edits => applyWorkspaceEdits(edits),
  applyConfiguration: configuration => configureBuildServices(configuration),
  setKeymap: id => setEditorKeymap(id),
  applyKeybindings: bindings => setCustomBindings(bindings),
  download,
  importFiles
});

shell.mount({menuHost, toolbarHost, statusHost});
// The existing renderPanel seam routes shell-owned panels before legacy renderers.
if (shell.hasTool(panelId)) await shell.renderTool(panelId, panelElement);
// Editor and workspace lifetimes drive contextual updates.
shell.update({type: 'cursor'});
shell.setReferences(await requestCompiler('references', {uri, offset}));
// Ownership is explicit: dispose the shell before its underlying services.
shell.dispose();
```

Test adapters register with `shell.tests.register(id, provider)`. Providers implement
`discover({signal})` and `run(testIds, {debug, signal, onResult})`; incremental results
carry a provider-local test id and one of queued, running, passed, failed, skipped or
cancelled. Commands remain unavailable until the required provider is registered.

Toolbox and property modules contribute through `shell.toolbox.register` and
`shell.properties.register`. Independent result panes keep their own scope and
selection. Root composition supplies clipboard, disk, project, navigation and editor
adapters; no tool is allowed to invent unavailable source or test results.
