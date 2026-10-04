# A19 document groups and window management

## Review branch scope

Review04 contains the docking, navigation, Watch and lazy tool source modules and their focused tests. Studio bootstrap wiring, actual Studio browser workflows, standalone bundling changes and A20 performance drivers remain in the dependent composition layer. Qualification records below describe the original completed source batches; no tests or builds were rerun for this review branch. The standalone docking DOM fixture is present and uses built assets with the production server/CSP, but remains unrun. See [project16-workbench-review.md](project16-workbench-review.md) for the exact scope and host contracts.

This document describes the Project 16 implementation contracts for SF-A19-T03, T04, T37, T38 and the docking portion of T10.3. It covers the browser DOM host and JavaScript model. Native cross-process docking, independent-window application lifetimes and OS monitor enumeration are outside this browser implementation.

## Capability inventory

| Work item | Implemented contract | Regression evidence |
| --- | --- | --- |
| T03.1 | One preview per document group, replaced on navigation, promoted on edit or double-click | `a19-03-document-tabs.test.js` |
| T03.2 | Pinned partition, pin/unpin, Close All But Pinned, persisted state | `a19-03-document-tabs.test.js` |
| T03.3 | Document context menu, close variants, explicit group moves and splits; unavailable host folder access disabled | `a19-03-document-tabs.test.js` |
| T03.4 | Complete Save/Discard/Cancel preflight, version race detection, all saves before closing; disposal cancels | `a19-03-document-tabs.test.js` |
| T03.5 | Ctrl+Tab MRU overlay, arrow/Home/End selection, modifier-release activation; Alt+F7 tools | `WindowNavigator`, browser host integration |
| T03.6 | All-tab overflow list, mouse/touch reorder, bounded reopen history with caret/scroll | unit and browser fixtures |
| T03.7 | Navigation locations include document group, view and popout identity; backward menu | `a19-window-layouts-navigation.test.js` |
| T04.1 | Nine explicit 40px target rectangles, group diamond and root edges, real DOM shading | model geometry and browser synthetic-pointer fixture |
| T04.2 | Four edge shelves, hover/click flyout, resize, pin to original identity anchors, Auto Hide All | model and browser fixtures |
| T04.3 | Floating tab groups and nested splits, title-bar re-dock, double-click toggle, one-step undo | model and browser fixtures |
| T04.4 | Same-origin popout DOM retention, focused panel tracking, shortcut forwarding, lossless close/return | browser F5 and reattach fixture |
| T04.5 | Layout schema v2, lossless v1 migration, explicit unknown identity diagnostics, viewport bounds clamp | model fixtures |
| T04.6 | Shift+Esc, Alt+minus, group maximize, arrow-key floating move/resize, tab and splitter keys | DOM adapter and Window commands |
| T04.7 | Bounded registered factories, independent panel instances, persistent exact IDs | factory fixture; Studio registers application-specific factories |
| T37 | Save/apply/manage/reset layouts; Ctrl+Alt+1…9; applying tool placement keeps open document set | layout fixture |
| T38 | Windows dialog activate/save/close selection, New Window shared buffer view, Full Screen, Close All Documents | tab/service contracts and Window commands |
| T10.3 | Pointer capture, cancellation/lost capture, touch/pen tab drag, long-press menu, coarse 40px hit regions | pointer/browser fixture; tree behavior is owned separately |

Capabilities requiring Studio composition use the explicit `attachDocuments()` service adapter. The source module does not silently create another text buffer or clone an existing tool's DOM/listeners.

## Embedding the package

Serve the repository and open `packages/docking/examples/index.html`. The sample is independent of the compiler and demonstrates tool/document tabs, all nine targets, splitters, complete floating groups, auto-hide, undo/redo, retained textareas and popout shortcut forwarding.

```js
import { DockLayout, DockHost } from '@sharpforge/docking';

const layout = new DockLayout([
  { id: 'editor', title: 'Program.cs', kind: 'document' },
  { id: 'watch', title: 'Watch 1', kind: 'tool' }
]);
const host = new DockHost(element, layout, {
  resolveContent: id => contents.get(id),
  requestClose: id => documentCloseService.close(id),
  onActivate: id => activeDocumentService.activate(id),
  onWindowKeyDown: event => commandRouter.handleKeyDown(event),
  onPopoutDocument: document => installContextMenu(document),
  onError: error => reportDiagnostic(error)
});
layout.open('editor');
layout.dockRoot('watch', 'left');
```

Import `@sharpforge/docking/src/style.css` through the host's package/CSS resolver or use the distributed `src/style.css` URL. It imports the package-local base and workbench styles. No external stylesheet, script or runtime dependency is added.

## Model transactions and persisted data

`DockLayout` v2 retains `root`, `floating`, `autoHide`, `closed` and `activePanel`. It adds `returnLocations`, `tabState` and `flyoutSizes`. Studio also persists explicit document-view and tool-instance records. Panel IDs keep their previous meaning. `DockLayout.restore()` is strict and atomic; malformed/unknown identities cause an exception without modifying the current layout. `restorePersisted()` is a recovery entry point: it migrates v1, reports dropped unknown/duplicate identities, reconciles newly registered closed panels and clamps floating bounds. A structurally corrupt layout becomes a valid empty document well with all known panels closed.

| Diagnostic | Meaning |
| --- | --- |
| `SFDOCK001` | Persisted panel identity no longer exists and was dropped |
| `SFDOCK002` | Duplicate persisted identity was dropped |
| `SFDOCK003` | Corrupt/unsupported persisted layout recovered to a valid layout |
| `SFDOCK004` | Browser blocked a requested popout |
| `SFDOCK005` | Persisted tool instance has no matching factory or a malformed identity |
| `SFTABS001` | Dirty close lacks an explicit decision adapter |
| `SFTABS002` | Save failed; the close batch remains open |
| `SFTABS003` | Document changed during the close decision; the close batch remains open |

Layouts are bounded to 2 MB serialized input, 512 nodes, depth 32, 64 floating groups and 8,192 registered panels. Named layout storage has an additional 100-entry/4 MB bound. Tool factories impose their own instance limits. Closed-tab and navigation histories are bounded independently.

`transaction(type, action)` coalesces nested model operations into one history entry and notification. Pointer operations mutate with `history:false` while retaining the initial snapshot, then call `finishInteraction(snapshot,{cancel,type})`. Cancellation restores the original state. There are no direct UI writes to the model's undo stacks.

Floating groups preserve their tree on edge docking. A center drop merges their tabs into the destination in deterministic traversal order, since a tab group cannot contain split children. Undo restores the exact floating tree.

Auto-hide return locations record the original group/index and original sibling panel identities. If the group has collapsed, pinning reconstructs it against an available original anchor. If every original anchor is gone, the saved workspace edge is used. No unrelated panel is substituted for a missing identity.

## Studio composition

```js
const services = docking.attachDocuments(documents, {
  confirmClose: (modifiedDocuments, { signal }) => showCloseChoices(modifiedDocuments, signal),
  copyPath: uri => clipboard.writeText(resolveFullPath(uri)),
  revealFile: uri => nativeWorkspace.revealContainingFolder(uri),
  confirmReset: () => showResetLayoutConfirmation()
});
commandRegistry.registerContributions(services.windows.descriptors());
```

The document adapter contract is `get`, `open`, `activate`, `save`, `close`, `subscribe`, `getViewState`, `restoreViewState` and optional `setTabs`. Buffer records provide `uri`, `text`, `version` and `dirty`. `close(uri,{discard:true})` represents an explicit user's discard choice. `createDocument(uri,{viewId,panelId})` must create a view over the service's existing buffer; multiple views have independent caret/scroll state and a common editing/undo model.

### Watch instances

Install `installWatchWindows({docking,sessions,commands,storage,onError})` from
`workbench/watch-windows/index.js` after `attachDocuments` and before the first
`docking.sync`. That registers the actual Watch factory before persisted layout
identities are restored. `window.watch1` through `window.watch4` are registered
user commands; `open(2,{sessionId})` can create a session-bound Watch 2. A normal
Watch window follows the active application, and its labeled selector can pin
it to another application without changing the global active process.

Each window owns its expression list, result map, input nodes and request
generation. It calls the captured `AppSession.request('evaluate',...)` with the
captured application identity and stack frame. A changed application/frame,
restart, hidden panel or disposal aborts or discards stale results. Evaluation
is sequential and limited to 128 expressions of at most 4096 characters. It
uses the runtime's existing side-effect-free evaluator; it never executes host
JavaScript or aliases the legacy shared watch-results map.

Only expressions and the chosen scope are persisted, under a versioned,
2 MiB/256-window bound. Evaluated values, network grants and runtime capabilities
are not serialized. Closing and reopening retains the same controller; removing
its panel disposes it, and a later explicit open restores the saved expressions.
Saved factory IDs retain their layout geometry. The installer returns `open`,
`get`, `descriptors` and `dispose`; dispose it during Studio teardown.

`tests/a19-watch-windows.test.js` exercises the actual command registry, docking
model/factories, controller DOM events and AppSession/WorkerClient boundaries.
Those controlled-worker tests do not claim actual browser or native-debugger
qualification.

The complete Watch scope passed 7/7 tests through
`node scripts/limited.js node --test tests/a19-watch-windows.test.js` on Node
24.19.0. Seven existing Window/layout tests also passed in the first scope run.
After synchronizing upstream, the local workspace required an offline npm link
refresh for the newly declared BCL collections package. The first Watch run then
identified a test's incorrect `locate().kind` expectation; the documented API
returns a group plus `floatingId`. The corrected assertion compares that exact
ID and the full restored floating geometry. No product assertion was weakened.

`docking.registerPanel({id,title,kind,element,onClose})` registers a dynamic application panel and returns a disposer. An asynchronous `onClose` returning false cancels closing. `registerToolKind(kind,factory,{limit,title})` and `createTool(kind,instance,{sessionId})` create independent tool instances. Tool factories receive the exact persistent record and must return a fresh DOM element for each new identity.

The host offers `menuProvider`, `requestClose`, `onPopoutDocument` and `onWindowFocus` callbacks. Studio uses these seams rather than replacing host methods. Global popout shortcuts are forwarded only if the event was not already handled locally.

### Shared Studio navigation

`StudioNavigation({docking,getEditor,onChanged})` bridges synchronous `openFile`
activation to `docking.navigation`. It owns no second history. Pair
`beforeOpen({uri,offset,view})` with `afterJump(token)` in `finally`; use
`afterJump(token,{record:false})` when opening fails. The outer operation captures
the departing editor before activation and the actual destination after `goto`.
Nested activation callbacks and workbench history replay cannot append duplicate
entries. Ordinary caret movement does not create a navigation stop.

The adapter exposes `capture`, `back`, `forward`, `menu(x,y)`, `clear`, `snapshot`,
`history`, `canBack` and `canForward`. Toolbar actions and command aliases call
these methods. The history dropdown uses the same workbench menu, including
original group/view/popout identity. `WorkbenchNavigation.subscribe` observes
both adapter calls and direct Window-management shortcuts; `update` and `clear`
are explicit service operations. Dispose the Studio adapter to remove its
listener, and clear history when replacing the workspace.

`tests/a19-studio-navigation.test.js` covers departure capture while docking is
ahead of editor activation, nested opens, failed opens, replay suppression,
shared dropdown state, clear and disposal. These are model/service checks; the
actual Studio toolbar and native browser shortcut path require integrated
browser qualification.

## Platform behavior and qualification

Browser popouts use a real same-origin child window. The original panel DOM is adopted into that document and reattached on pagehide/beforeunload/observed close. They require a live opener and browser popup permission. A popup's native screen coordinates are not persisted; the model clamps its in-page floating geometry when the host viewport changes. Existing popout identities in navigation history focus the matching live child; after that child has closed, the location is restored in the main workspace without recreating an unsolicited popup.

Full Screen is a workbench chrome mode: it expands the document well and hides tool windows, with restoration of the previous arrangement. Browser OS fullscreen is deliberately a distinct platform feature and is not invoked. Open Containing Folder is enabled only when an explicit native/filesystem adapter is supplied.

The browser fixture uses real Chromium DOM, synthetic PointerEvents for each of the nine guide targets, real popup windows and F5 routing. These checks do not constitute Windows/macOS native-window qualification or screen-reader certification. The coarse-pointer styles expose 40px targets and the pointer controller captures trusted touch/pen events; pointer cancellation shares the tested transaction contract.

## Completed-scope validation commands

After implementation of the complete owned scope:

```sh
node --test tests/docking.test.js tests/a19-04-docking-model.test.js tests/a19-03-document-tabs.test.js tests/a19-window-layouts-navigation.test.js
python tests/browser_a19_docking_test.py
npm run check
npm run check:structure
```

The integration owner runs the complete Project 16 required check and browser/editor/session matrix after stacking the completed scopes. No native, CLR, Wasm runtime or compiler behavior is modified by these modules.
