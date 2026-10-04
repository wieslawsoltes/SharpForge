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
| Edit and save source | DocumentService, active native editor and save provider | Document service and editor suites; shell delegates edits and saves | The native editor is supplied by A20; OS/browser qualification is recorded separately |
| Command routing | Shared controls registry with contextual descriptions and aliases | `a19-shell-commands.test.js` checks menu/palette/Command Window shared enablement | `browser_a19_shell_test.py` checks live menu and keyboard host |
| Multi-project build | Per-project BuildServices, solution configuration mapping | Session service tests; `a19-shell-settings.test.js` checks selected Release mappings | Real CLR/native MSBuild qualification is separate; no simulator is native evidence |
| Debug and app sessions | SessionManager, app windows, Debug Location, Processes, measured execution capture | Session suites plus `a19-execution-occupancy`, `a19-execution-capture` and actual `a19-execution-worker` tests | Per-launch graphs show actual worker execution occupancy, delivery-time events and managed heap statistics; browser presentation remains a separate qualification |
| Code and designer navigation | Symbol requests, safe Outline reorder, Class View, Code Definition, bookmarks | Shell suites plus `a19-outline-reorder`, `a19-outline-host` and `a19-metadata-providers` tests | Metadata source covers authorized referenced PE declarations and actual core/framework contracts; the 300 ms follow-caret browser threshold remains unqualified |
| Find and replace | Worker search, exact UTF-16 spans, versioned result windows, per-document edits | `a19-shell-search.test.js` checks cancellation, stale results, selected replacement and limits | Regex requires an interruptible worker; no main-thread regex fallback |
| Error List | Source, severity, scope, sorting, copy and column model | 5,000-diagnostic fixture in `a19-shell-search.test.js` | Live grid browser checks required for pixel/DPI claims |
| Output | Bounded lines, pane/scope selectors, parsed file links, virtual grid | 100,000-line fixture and link tests in `a19-shell-search.test.js` | Browser scrolling is independently tested; line retention is bounded by OutputChannels |
| Test | Test provider contract and Test Explorer host | Fake-provider host acceptance tests in `a19-shell-tools.test.js` | No built-in xUnit/NUnit/MSTest runner is claimed; unregistered provider is shown in UI |
| Design | Existing DesignDocument and DesignerTools; Toolbox/Properties/Outline adapters | Existing `browser_release12_test.py`; shell provider selection/tree tests and versioned source reorder tests | Designer reparent uses its existing validation; source moves reject storage-bearing members, directives, recovered syntax and stale versions |
| Settings | Versioned schema, user/workspace overrides, atomic Options transaction, import preview | `a19-shell-settings.test.js` covers migration, corrupt settings, quotas and secret exclusion | Studio/release08–14 and shell styles use semantic tokens and forced colors; browser/DPI/pixel qualification remains separate |
| Recent workspaces | Metadata-only MRU, current workspace, current/previous recovery and sample providers | `a19-shell-recents.test.js` checks identity, confirmation, cancellation and encoding/BOM/binary preservation | Root composition supplies authorized reopen providers; missing permission cannot report a successful open |
| Recovery and external edits | FileWatch with explicit disk reader, reload callback, compare and recovery store | `a19-shell-settings.test.js` checks once-per-version notification and bounded drops | Browser polling works only for supplied authorized handles; no operating-system watcher is claimed |
| Publish/export | Existing DLL/project/archive export commands | Existing export browser suites | No new hosting or native installer pipeline is introduced by A19 |
| Source control | Existing external Git workflow; no in-browser Git provider | Not implemented in this shell | Explicit gap: repository status/staging/commit UI needs a Git provider |

## Theme source contract

The #1566 migration moves the literal colors in Studio and the split release08–14
styles into `apps/studio/themes.css` and `workbench/designer-tokens.css`. The shell
palette remains in `workbench/theme-tokens.css`. The three files are the only
explicit color-token allowlist; package-owned editor, controls and docking styles
have their own ownership and are outside this issue's named source scope.

The migration retains 350 original dark/light token values and the original paint
cascade. Two ordered paint modules precede package and release styles. The frozen
`studio.css` shrinks from 49,885 to 37,644 bytes. A fixture anchored at 34a28b52 checks
955 ordered paint declarations and 2,421 other declarations across 26 original files,
including responsive rules, keyframes and known existing fallback aliases. The
reviewed concatenated stylesheet snapshot additionally pins every current byte
and sorted/ordered rule fingerprint.

`a19-shell-themes.test.js` rejects misplaced hex and numeric functional colors,
including gradient, shadow and fallback literals. It distinguishes selectors,
comments, strings and URL fragments, rejects malformed CSS, and verifies token
file declarations and contribution order. Dark/Light preserve their source colors;
Blue retains syntax distinctions; High Contrast and forced colors resolve every
legacy token. The system setting listens for OS scheme changes and removes its
listener on disposal. Selected shell text uses HighlightText in forced colors.
These are source and model checks, not a claim of native rendering or pixel parity.

At d5b1d153, the combined completed-scope cohort passed 74/74 checks: 70 shell cases
and 4 shared stylesheet contract cases. No test was skipped. Browser drivers,
screen-reader testing, device DPI and Visual Studio oracle comparisons remain
separately qualified by the integration lane.

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

Run the complete shell scope in its scheduled validation slot after implementation:

```sh
node scripts/limited.js node --test tests/a19-shell-commands.test.js tests/a19-shell-settings.test.js tests/a19-shell-search.test.js tests/a19-shell-tools.test.js tests/a19-shell-boundaries.test.js tests/a19-shell-inventory.test.js tests/a19-shell-recents.test.js tests/a19-shell-themes.test.js tests/a00-20-styles.test.js
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

The large-workspace driver creates one real project with 501 C# source files in
three independent browser contexts. Each context starts with fresh storage, models,
workers and tool instances. `cold-app-startup` measures navigation to the default
application being ready and painted; `workspace-startup` starts immediately before
loading the complete 501-source fixture and ends after loading/building finishes
and two animation frames have elapsed. Each context then opens 20 documents and
activates five real tools four times. Object Browser activation also waits for
actual framework metadata to appear. The browser process and host filesystem are
shared between rounds; this is not a cold machine benchmark.

The version 2 capture contains all raw samples and recomputed nearest-rank p50,
p95 and p99, with exact browser/OS/viewport environment metadata and a fixture
SHA-256. Missing or duplicate metrics, nonfinite values, fabricated percentiles,
incomplete sample rounds, browser errors and incompatible captures are rejected.
Set `SHARPFORGE_BROWSER_VARIANT` to `static` or `standalone` to identify the artifact
served by the shared browser harness. The compatibility checks also record the
actual application pathname and in-memory versus HTTP loading mode.

Set `SHARPFORGE_WORKBENCH_BASELINE` to a previously reviewed compatible capture
to enforce the 20-percent relative p95 regression gate. Without one, capture mode
reports `regressionVerdict: null`; it can only assess the absolute limits of
10 seconds for each startup metric, 250 ms for document switching and 1500 ms
for tool activation. The separate comparator
`node tests/workbench-perf-budget.mjs current.json baseline.json` checks captures
without launching another browser. `--capture current.json` validates an initial
capture without inventing a historical baseline. No browser timing or speedup is
claimed until the integrated static and standalone drivers actually run.

Status updates read indexed document positions and EOL metadata. Visual `Col`
and line-relative UTF-16 `Ch` use separate values. Exact model column queries are
cancellable and stale results are discarded; older hosts without that model seam
use a prefix of at most 16 KiB and report an unavailable column beyond it. Definition
previews show bounded 64 KiB excerpts. Solution Explorer content filters run in
the search worker with 8-million-unit per-file and 32-million-unit total limits,
reported explicitly when exceeded. Settings reads clone only the requested value.
These bounds are regression-tested; main-thread and allocation timings still
require the integrated browser capture.

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

`createRecentWorkspaces` accepts `recent`, `getCurrent`, `readRecovery`,
`activateCurrent`, `openRecords`, `loadSample` and `openFolder` providers.
`remember(metadata)` retains only a stable URI, name, kind and optional workspace
identifier. `open(item)` first activates a matching current workspace, then tries
samples or the matching current/previous recovery. Recovery records are prepared
only on explicit Open and preserve encoding, BOM, original bytes/base64 and unsaved
source metadata. An unavailable workspace invokes `openFolder(item,
{reason: 'permission-required'})`. A provider must confirm success explicitly or
produce the requested current identity; cancellation preserves the MRU and keeps
the Start window open.

Line-ending normalization is opt-in through `editor.normalizeLineEndings`, which
defaults to false. Text Editor Options exposes the explicit checkbox and LF/CRLF/CR
choice. General theme or font changes preserve each file's EOL policy. A host
`applySettings` callback owns applying workspace preferences and then per-file
EditorConfig overrides to every view; the shell does not apply a second generic
override afterward.
