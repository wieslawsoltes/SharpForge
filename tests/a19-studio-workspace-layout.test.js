import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { studioDockingFixture } from './support/studio-docking-fixture.js';

function load(fixture, records, options = {}) {
  const paths = records.map(record => record.path ?? record.uri).filter(path => path.endsWith('.cs'));
  return loadStudioWorkspace(records, {
    mode: 'folder', name: 'Layout replacement', settings: { tabs: paths, active: paths[0] ?? '' }, ...options
  }, fixture.context);
}

const sources = (...uris) => uris.map(path => ({ path, text: `// ${path}\nclass Example {}` }));

test('workspace replacement publishes one valid layout before real retained content is resolved', async t => {
  const fixture = studioDockingFixture(t);
  const { docking, host, layout, tabs, services, created, resolved } = fixture;
  await load(fixture, sources('Program.cs', 'Particle.cs', 'Scene.cs'));
  const sourceWindow = host.popout('source:Particle.cs');
  const toolWindow = host.popout('output');
  layout.open('app:one');
  const application = host.contents.get('app:one');
  const output = host.contents.get('output');
  const previousViews = created.filter(item => services.documents.get(item.uri));
  const start = resolved.length;
  const renders = host.renderCount;
  const publications = [];
  t.after(layout.subscribe(event => {
    const uris = tabs.list().map(id => tabs.metadata(id).uri);
    assert.equal(uris.every(uri => services.documents.get(uri)), true, 'Every published source must have a current document');
    publications.push({ type: event.type, uris });
  }));

  await load(fixture, sources('New.cs', 'Helper.cs'));

  assert.deepEqual(publications, [{ type: 'syncDocuments', uris: ['New.cs', 'Helper.cs'] }]);
  assert.equal(host.renderCount, renders + 1);
  assert.deepEqual(resolved.slice(start).map(item => item.uri), ['New.cs', 'Helper.cs']);
  assert.equal(layout.state.activePanel, 'app:one');
  assert.equal(host.contents.get('app:one'), application);
  assert.equal(host.contents.get('output'), output);
  assert.equal(sourceWindow.closed, true);
  assert.equal(toolWindow.closed, false);
  assert.equal(host.popouts.get('output').window, toolWindow);
  for (const { uri, editor } of previousViews) {
    assert.equal(editor.disposed, true);
    assert.equal(layout.panels.has(`source:${uri}`), false);
    assert.equal(docking.content.has(`source:${uri}`), false);
  }
  assert.equal(layout.undo(), false, 'Undo must not restore an obsolete workspace panel');
  assert.doesNotThrow(() => layout.validate(layout.state));
});

test('same-URI replacement refreshes primary and split view content even when the layout is unchanged', async t => {
  const fixture = studioDockingFixture(t);
  const { host, layout, tabs, services } = fixture;
  await load(fixture, sources('Shared.cs'));
  const secondary = await tabs.newView('source:Shared.cs');
  const previousModel = services.documents.models.get('Shared.cs');
  const previousViews = [...services.documents.views.get('Shared.cs').values()];
  const previousContent = host.contents.get(secondary);
  const placement = layout.serialize();
  const renders = host.renderCount;

  await load(fixture, [{ path: 'Shared.cs', text: 'class Replacement {}' }]);

  assert.equal(layout.serialize(), placement);
  assert.equal(layout.state.activePanel, secondary);
  assert.equal(host.renderCount, renders + 1, 'An unchanged layout still needs its replacement content rendered');
  assert.notEqual(host.contents.get(secondary), previousContent);
  const currentModel = services.documents.models.get('Shared.cs');
  assert.notEqual(currentModel, previousModel);
  assert.equal(currentModel.getText(), 'class Replacement {}');
  assert.equal(services.documents.views.get('Shared.cs').size, 2);
  for (const view of services.documents.views.get('Shared.cs').values()) assert.equal(view.editor.model, currentModel);
  for (const view of previousViews) assert.equal(view.editor.disposed, true);
  assert.throws(() => previousModel.prepareEdits([]), /disposed/);
});

test('incremental replacement removes split, floating, popout and closed source views without replacing surviving owners', async t => {
  const fixture = studioDockingFixture(t);
  const { docking, host, layout, tabs, services, focused } = fixture;
  await load(fixture, sources('Keep.cs', 'Particle.cs', 'Closed.cs'));
  const secondary = await tabs.newView('source:Particle.cs');
  layout.float(secondary);
  const sourceWindow = host.popout('source:Particle.cs');
  const toolWindow = host.popout('output');
  await tabs.close('source:Closed.cs');
  assert.equal(tabs.closed.at(-1).uri, 'Closed.cs');
  layout.activate('output');
  const keep = services.documents.get('Keep.cs');
  const keepModel = services.documents.models.get('Keep.cs');
  const keepView = services.documents.editors.get('Keep.cs');
  const keepContent = host.contents.get('source:Keep.cs');
  const renders = host.renderCount;

  await load(fixture, [keep, ...sources('Added.cs')], { preserveDocumentState: true, updateOnly: true });

  assert.equal(host.renderCount, renders + 1, 'Returning obsolete source popouts must not render during reconciliation');
  assert.equal(sourceWindow.closed, true);
  assert.equal(toolWindow.closed, false);
  assert.equal(host.popouts.get('output').window, toolWindow);
  assert.equal(focused.at(-1).id, 'main');
  assert.equal(focused.at(-1).window, fixture.document.defaultView);
  assert.equal(layout.state.activePanel, 'output');
  assert.equal(services.documents.models.get('Keep.cs'), keepModel);
  assert.equal(services.documents.editors.get('Keep.cs'), keepView);
  assert.equal(host.contents.get('source:Keep.cs'), keepContent);
  assert.equal(keepView.disposed, false);
  assert.equal(layout.state.floating.length, 0);
  for (const id of [secondary, 'source:Particle.cs', 'source:Closed.cs']) {
    assert.equal(layout.panels.has(id), false);
    assert.equal(host.contents.has(id), false);
    assert.equal(docking.content.has(id), false);
    assert.equal(tabs.mru.includes(id), false);
  }
  assert.deepEqual(tabs.closed, []);
  assert.equal(await tabs.reopenClosed(), null);
  assert.equal(layout.undo(), false);
});

test('an empty source workspace retains its selected tool and does not resolve a removed document', async t => {
  const fixture = studioDockingFixture(t);
  await load(fixture, sources('Program.cs', 'Particle.cs'));
  fixture.layout.activate('output');
  const resolved = fixture.resolved.length;
  await load(fixture, [{ path: 'README.txt', text: 'No source documents' }]);
  assert.deepEqual(fixture.tabs.list(), []);
  assert.equal(fixture.layout.state.activePanel, 'output');
  assert.equal(fixture.services.documents.views.size, 0);
  assert.equal(fixture.resolved.length, resolved);
  assert.doesNotThrow(() => fixture.layout.validate(fixture.layout.state));
});

test('metadata-only sync refreshes a retained tab dirty affordance without a document-service event', t => {
  const { docking, host, layout, state } = studioDockingFixture(t);
  docking.documents = null;
  const placement = layout.serialize();
  const content = host.contents.get('source:Old.cs');
  let renders = host.renderCount;
  for (const dirty of [true, false]) {
    docking.sync([{ uri: 'Old.cs', dirty }], state.tabs, state.active);
    const tab = host.element.querySelector('[data-dock-tab="source:Old.cs"]');
    assert.equal(tab.classList.contains('dirty'), dirty);
    assert.equal(tab.getAttribute('aria-label').includes('modified'), dirty);
    assert.equal(layout.serialize(), placement);
    assert.equal(host.contents.get('source:Old.cs'), content);
    assert.equal(host.renderCount, ++renders);
  }
});

test('a real replacement content failure stays visible and the committed layout can render after its cause is corrected', async t => {
  const fixture = studioDockingFixture(t);
  const failure = fixture.failCreation('Broken.cs');
  await assert.rejects(() => load(fixture, sources('Broken.cs')), error => error === failure);
  assert.equal(fixture.layout.panels.has('source:Old.cs'), false);
  assert.ok(fixture.services.documents.get('Broken.cs'));
  assert.equal(fixture.host.contents.has('source:Broken.cs'), false);
  fixture.failCreation(null);
  fixture.docking.sync(fixture.state.files, fixture.state.tabs, fixture.state.active);
  assert.equal(fixture.services.documents.editors.get('Broken.cs').disposed, false);
  assert.ok(fixture.host.contents.get('source:Broken.cs'));
});

test('normal popout return keeps its default reopen, render, DOM identity and owner-focus behavior', t => {
  const { host, layout, document, focused } = studioDockingFixture(t);
  const content = host.contents.get('source:Old.cs');
  const child = host.popout('source:Old.cs');
  layout.close('source:Old.cs');
  const renders = host.renderCount;
  assert.equal(host.returnPopout('source:Old.cs'), true);
  assert.equal(child.closed, true);
  assert.notEqual(layout.locate('source:Old.cs').kind, 'closed');
  assert.equal(host.contents.get('source:Old.cs'), content);
  assert.equal(content.ownerDocument, document);
  assert.ok(host.renderCount > renders);
  assert.equal(host.windowWatch, null);
  assert.equal(focused.at(-1).id, 'main');
  assert.equal(focused.at(-1).window, document.defaultView);
});

test('explicit popout render deferral leaves a closed panel closed until the caller completes its update', t => {
  const { host, layout, document } = studioDockingFixture(t);
  const child = host.popout('source:Old.cs');
  layout.close('source:Old.cs');
  const renders = host.renderCount;
  host.returnPopout('source:Old.cs', { reopen: false, render: false });
  assert.equal(child.closed, true);
  assert.equal(host.renderCount, renders);
  assert.equal(layout.locate('source:Old.cs').kind, 'closed');
  assert.equal(host.contents.get('source:Old.cs').ownerDocument, document);
  host.render();
  assert.equal(host.renderCount, renders + 1);
  assert.equal(host.windowWatch, null);
});
