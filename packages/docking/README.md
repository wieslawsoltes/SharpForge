# @sharpforge/docking

Independent MIT-licensed docking model and DOM host. No Studio, compiler, renderer or framework dependency.

```js
import { DockLayout, DockHost } from '@sharpforge/docking';
// Also load @sharpforge/docking/style.css using your host's CSS pipeline.
const layout = new DockLayout([
  { id: 'editor', title: 'Program.cs', kind: 'document' },
  { id: 'output', title: 'Output', kind: 'tool' }
]);
layout.open('editor');
layout.dockRoot('output', 'bottom');
const contents = new Map([
  ['editor', document.createElement('textarea')],
  ['output', document.createElement('pre')]
]);
const host = new DockHost(document.querySelector('#workspace'), layout, {
  resolveContent: id => contents.get(id),
  onActivate: id => console.log('Activated', id),
  onError: error => console.error(error)
});
const saved = layout.serialize();
layout.float('output', { x: 60, y: 60, width: 500, height: 280 });
layout.restore(saved);
// On teardown: host.dispose().
```

Model operations: register/unregister, locate, groups, open/activate/close, dock center/edge, dockRoot, float, autoHide, resize, bounds, snapshot/serialize/validate/restore, undo/redo, and subscribe. Every registered panel has exactly one placement (group, shelf or closed). Mutations validate and roll back; the default history is 50 layout changes. Trees allow 512 nodes / 32 nesting levels / 64 floating groups. Empty document groups remain usable drop targets.

The DOM host moves and caches content elements, preserving host-owned editor buffers and listeners. It supplies nested resizable groups, scrollable tab strips, drag/drop guides, floating move/resize, auto-hide shelves, tab context menus, keyboard tab navigation, keyboard splitters, and same-origin browser popouts. Use `popout(id)` / `returnPopout(id)` for tools **or documents**. Popup blocking is reported. Closing a popup returns its exact DOM; a short-lived host watchdog also handles forced browser-window closure. `onWindowKeyDown` can forward host shortcuts.

Hosts own storage and document state; the model does not save application buffers. Popout OS position is not persisted. No native desktop cross-process docking, arbitrary cross-origin window transport, tab tear-off between unrelated pages, or pixel-exact Visual Studio parity is claimed. See `docs/docking.md` and the model/browser tests.

External controls that toggle an auto-hide panel can declare `data-dock-toggle="panel-id"`. A pointer press on the active panel's toggle preserves the popup until its click handler toggles it closed; other outside presses still dismiss it. This avoids a dismiss-on-pointerdown/reopen-on-click race without canceling normal pointer or keyboard activation.
