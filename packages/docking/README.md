# @sharpforge/docking

A dependency-free docking model and browser DOM host for document and tool workspaces. The package retains panel DOM and editor state while supporting splits, tab groups, explicit dock targets, floating nested groups, auto-hide, undo/redo, keyboard operation and same-origin popouts.

## Quick start

```js
import { DockLayout, DockHost } from '@sharpforge/docking';

const layout = new DockLayout([
  { id: 'source', title: 'Program.cs', kind: 'document' },
  { id: 'output', title: 'Output', kind: 'tool' }
]);
const host = new DockHost(document.querySelector('#workspace'), layout, {
  resolveContent: id => panels.get(id),
  requestClose: id => closeService.close(id),
  onActivate: id => activatePanel(id),
  onWindowKeyDown: event => routeShortcut(event),
  onError: error => reportError(error)
});
layout.open('source');
layout.dockRoot('output', 'bottom');
```

Load the distributed `src/style.css`. Serve `examples/index.html` for a runnable standalone example with retained textareas, nine drop targets, whole-group floating, undo/redo and popouts.

The example uses external JavaScript and CSS and is included in the package.
In this repository, build the completed scope once with `npm run build`, start
`node scripts/serve.js`, and open
`http://127.0.0.1:4173/packages/docking/examples/index.html`.
The production server applies the same Content Security Policy as Studio.
Studio contributes `src/host/workbench.css` at order 1999 to extend its retained
base host styles before the editor styles and later Studio theme overrides.

## Public API

| API | Contract |
| --- | --- |
| `DockLayout` | One placement per registered panel; bounded validated transactional state |
| `createGroup`, `createSplit`, `walkLayout`, `panelIds` | Explicit serializable tree helpers |
| `dock`, `dockRoot`, `float`, `autoHide`, `pin` | Individual panel placement and identity-based restoration |
| `floatGroup(nodeId,bounds)`, `dockGroup(nodeId,targetId,side,{root})` | Whole group/split moves with one undo step |
| `transaction(type,action)`, `finishInteraction(snapshot,{cancel,type})` | Coalesced operations and cancel-safe pointer history |
| `setTabState(id,{pinned,preview})`, `resizeFlyout(id,size)` | Persisted tab partition and flyout dimensions |
| `restore` | Strict atomic restore; migration from schema v1 is lossless |
| `restorePersisted`, `restorePersistedLayout` | Recovery with explicit unknown/duplicate/corrupt diagnostics |
| `DOCK_LAYOUT_VERSION`, `DOCK_LAYOUT_LIMITS`, `migrateLayout` | Versioned schema contract and bounded input |
| `clampFloatingBounds` | CSS-pixel viewport bounds correction |
| `dockGuideTargets`, `hitDockGuide`, `DockGuideOverlay` | Nine explicit targets shared by geometry and DOM |
| `DockHost` | Retained DOM rendering, accessible tab menus, pointer capture, keyboard docking and popouts |

`DockHost` accepts `resolveContent`, `onActivate`, `onError`, `onClose`, `requestClose`, `onWindowKeyDown`, `onWindowFocus`, `onPopoutDocument`, `onTabDoubleClick` and `menuProvider`. `requestClose` delegates dirty-document policy to the application. The core layout does not persist buffers or decide whether source changes can be discarded.

External auto-hide toggles may set `data-dock-toggle="panel-id"` to preserve the existing pointerdown/click toggle race fix. Pointer and keyboard resizing preserves focused content and selection; active tabs are revealed horizontally without scrolling document or tool bodies.

Popouts adopt the exact panel element into a real same-origin child and return it on close. Popup blocking is reported as `SFDOCK004`. The opener must remain alive. Native cross-process docking, unrelated browser-tab merging, arbitrary cross-origin transport and persistent OS window geometry are outside the contract.

`host.returnPopout(id, {reopen = true, render = true})` closes the child and returns its retained content.
The defaults preserve normal close, rendering, and window-focus notification behavior.
Workspace owners may use `{reopen: false, render: false}` while removing or replacing documents, then render
after their complete layout transaction. This prevents content resolution against an intermediate old workspace;
`render: false` does not defer a layout notification caused by `reopen: true`.

Studio's higher-level `DocumentTabs`, navigation, shared views and Window menus are documented in [`docs/a19-docking-workbench.md`](../../docs/a19-docking-workbench.md).
