import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout, DockHost } from '@sharpforge/docking';
import { StudioDocking } from '../apps/studio/workbench/layout-workspace.js';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { dockingDom } from './support/a19-docking-dom.js';

function fixture(t) {
  const {document, root} = dockingDom();
  const created = [];
  const disposed = [];
  const documents = new DocumentService({
    records: ['Program.cs', 'Particle.cs'].map(uri => ({uri, text: `class ${uri.split('.')[0]} {}`})),
    createEditor(record, {viewId}) {
      created.push(`${record.uri}:${viewId}`);
      return {element: document.createElement('div'), dispose() { disposed.push(`${record.uri}:${viewId}`); }};
    }
  });
  const layout = new DockLayout();
  const tabs = new DocumentTabs({layout, documents});
  const docking = Object.assign(Object.create(StudioDocking.prototype), {
    layout, tabs, documents, content: new Map(), adapt() {},
    createDocument: (uri, options) => documents.createDocument(uri, options)
  });
  const host = new DockHost(root, layout, {resolveContent: id => docking.resolve(id)});
  docking.host = host;
  docking.sync(documents.files, ['Program.cs', 'Particle.cs'], 'Program.cs');
  t.after(() => { host.dispose(); tabs.dispose(); documents.dispose(); });
  return {document, root, documents, layout, tabs, docking, host, created, disposed};
}

function replaceOwnerAndRetireViews(fixture, records = [{uri: 'App/Program.cs', text: 'class App {}'}]) {
  fixture.documents.replace(records, {
    discard: true, preserveEditors: true, tabs: records.map(record => record.uri), active: records[0]?.uri ?? ''
  });
  fixture.documents.resetEditors();
  // Full workspace replacement retires content caches before Studio's next renderTabs/docking.sync call.
  fixture.host.contents.clear();
  fixture.docking.content.clear();
  fixture.created.length = 0;
}

test('workspace replacement retires every old document view before a real docking render resolves content', async t => {
  const f = fixture(t);
  const second = await f.tabs.newView('source:Particle.cs');
  replaceOwnerAndRetireViews(f);
  const retirements = [];
  const off = f.layout.subscribe(event => {
    if (event.type !== 'retirePanels') return;
    retirements.push([...f.layout.panels.keys()]);
    assert.equal(f.layout.undoStack.length, 0, 'Retired identities must never enter layout undo history');
  });
  t.after(off);
  f.docking.sync(f.documents.files, f.documents.tabs, f.documents.active);
  assert.deepEqual(retirements, [[]], 'A renderer must never observe a partially retired old workspace');
  assert.deepEqual(f.created, ['App/Program.cs:primary']);
  assert.deepEqual(f.disposed.sort(), ['Particle.cs:primary', 'Particle.cs:view-1', 'Program.cs:primary'].sort());
  assert.equal(f.tabs.metadata(second), null);
  assert.deepEqual([...f.documents.views.keys()], ['App/Program.cs']);
  assert.equal(f.layout.state.activePanel, 'source:App/Program.cs');
  assert.equal(f.root.querySelector('[data-dock-panel="source:App/Program.cs"]').hidden, false);
  assert.equal(f.root.querySelector('[data-dock-panel="source:Particle.cs"]'), null);
  assert.equal(f.layout.undo(), true);
  assert.deepEqual([...f.layout.panels.keys()], ['source:App/Program.cs']);
  f.layout.validate(f.layout.state);
});

test('removed popouts close only after the entire panel set is retired and cannot recreate old documents', t => {
  const f = fixture(t);
  const closed = [];
  const controllers = [];
  for (const id of ['source:Program.cs', 'source:Particle.cs']) {
    const controller = new AbortController();
    controllers.push(controller);
    f.host.popouts.set(id, {controller, window: {closed: false, close() { this.closed = true; closed.push(id); }}});
  }
  replaceOwnerAndRetireViews(f);
  const focusEvents = [];
  f.host.onWindowFocus = event => {
    focusEvents.push(event.panelId);
    assert.equal(f.layout.panels.has('source:Program.cs'), false);
    assert.equal(f.layout.panels.has('source:Particle.cs'), false);
  };
  f.docking.sync(f.documents.files, f.documents.tabs, f.documents.active);
  assert.deepEqual(closed, ['source:Program.cs', 'source:Particle.cs']);
  assert.deepEqual(focusEvents, closed);
  assert.ok(controllers.every(controller => controller.signal.aborted));
  assert.equal(f.host.popouts.size, 0);
  assert.deepEqual(f.created, ['App/Program.cs:primary']);
  assert.equal(f.root.querySelector('[data-dock-panel="source:App/Program.cs"]').hidden, false);
});

test('an empty replacement retires documents without a history entry and repeated synchronization is inert', t => {
  const f = fixture(t);
  replaceOwnerAndRetireViews(f, []);
  const notifications = [];
  const off = f.layout.subscribe(event => notifications.push(event.type));
  t.after(off);
  f.docking.sync([], [], '');
  assert.deepEqual(notifications, ['retirePanels']);
  assert.equal(f.layout.undo(), false);
  assert.equal(f.layout.redo(), false);
  assert.equal(f.layout.panels.size, 0);
  assert.deepEqual(f.created, []);
  f.docking.sync([], [], '');
  assert.deepEqual(notifications, ['retirePanels']);
});

test('a rendering failure remains explicit and does not prevent retired popout cleanup', t => {
  const f = fixture(t);
  const failure = new Error('Retirement observer failed');
  const controller = new AbortController();
  const popout = {closed: false, close() { this.closed = true; }};
  f.host.popouts.set('source:Particle.cs', {controller, window: popout});
  replaceOwnerAndRetireViews(f, []);
  const off = f.layout.subscribe(() => { throw failure; });
  t.after(off);
  assert.throws(() => f.docking.sync([], [], ''), error => error === failure);
  assert.equal(popout.closed, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(f.host.popouts.size, 0);
  assert.equal(f.layout.panels.size, 0);
});
