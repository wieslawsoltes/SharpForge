import test from 'node:test';
import assert from 'node:assert/strict';
import {FoldingStateStore} from '@sharpforge/editor';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {WorkbenchShell} from '../apps/studio/workbench/shell.js';
import {registerStatusRegions} from '../apps/studio/workbench/status-bar.js';
import {loadStudioWorkspace} from '../apps/studio/workbench/studio-workspace-loader.js';
import {studioLoaderFixture} from './support/studio-loader-fixture.js';
import {ownershipView} from './support/editor-view-ownership.js';

function composedFixture(t) {
  const cleanup = [];
  const fixture = studioLoaderFixture({after: callback => cleanup.push(callback)});
  const {services, state, context} = fixture;
  const original = services.documents.models.get(state.active);
  let editor = ownershipView(original, {models: services.documents.models, views: new Set(), foldingState: new FoldingStateStore()});
  editor.selections = [{anchor: original.length, active: original.length}];
  services.documents.attachEditor(state.active, editor);
  const commands = createCommandRegistry();
  const errors = [], regions = new Map(), subscriptions = [];
  const shell = new WorkbenchShell({services, commands, state: () => state,
    document: {body: {}, activeElement: null}, dialogs: {dispose() {}},
    getEditor: () => editor, requestCompiler: (...args) => context.projectServices.request(...args), navigate() {},
    isToolVisible: () => false, onError: error => errors.push(error)});
  const bar = {
    onError: error => errors.push(error),
    register(region) {
      regions.set(region.id, region);
      const update = () => { region.last = region.value(); };
      const unsubscribe = region.subscribe?.(update);
      if (unsubscribe) subscriptions.push(unsubscribe);
      update();
    },
    update() { for (const region of regions.values()) region.last = region.value(); },
    dispose() { for (const unsubscribe of subscriptions.splice(0)) unsubscribe(); }
  };
  registerStatusRegions(bar, {context: () => shell.context(), documents: services.documents,
    tasks: shell.tasks, notifications: shell.notifications, settings: shell.settings, execute() {}});
  shell.statusBar = bar;
  const beforeReset = context.resetEditors;
  context.resetEditors = () => { beforeReset(); editor = null; };
  t.after(() => {
    shell.dispose(); commands.dispose(); context.projectServices.dispose();
    for (const dispose of cleanup.reverse()) dispose();
  });
  return {...fixture, original, shell, errors, regions};
}

for (const uri of ['New.cs', 'Old.cs']) {
  test(`actual view disposal and shell listeners preserve replacement model ownership at ${uri}`, async t => {
    const {services, context, original, shell, errors, regions} = composedFixture(t);
    const observed = [];
    const unsubscribe = services.documents.subscribe(event => {
      if (event.type !== 'reset' && event.type !== 'membership') return;
      observed.push({type: event.type, models: [...services.documents.models.keys()], context: shell.context()});
    });
    t.after(unsubscribe);
    await loadStudioWorkspace([{path: uri, text: 'x'}], {mode: 'folder', name: 'Replacement'}, context);
    const replacement = services.documents.models.get(uri);
    assert.notEqual(replacement, original);
    assert.deepEqual([...services.documents.models.keys()], [uri]);
    assert.deepEqual(services.documents.projectsFor(uri), ['$workspace']);
    assert.equal(services.documents.views.size, 0);
    assert.throws(() => original.prepareEdits([]), /disposed/);
    assert.doesNotThrow(() => services.locks.apply());
    assert.doesNotThrow(() => replacement.prepareEdits([]));
    assert.equal(observed.some(event => event.type === 'membership'), true);
    for (const event of observed) {
      assert.deepEqual(event.models, [uri]);
      assert.equal(event.context.uri, uri);
      assert.equal(event.context.caretOffset, 0);
    }
    assert.match(regions.get('cursor').last, /^Ln 1, Col (1|pending), Ch 1$/);
    assert.deepEqual(errors, []);
  });
}

test('a genuine membership listener failure remains observable after the view ownership correction', t => {
  const {services} = composedFixture(t);
  const failure = new Error('membership subscriber failed');
  const seen = [];
  const fail = services.documents.subscribe(event => { if (event.type === 'membership') throw failure; });
  const observe = services.documents.subscribe(event => { if (event.type === 'membership') seen.push(event.projectId); });
  t.after(() => { fail(); observe(); });
  assert.throws(() => services.documents.setProjectMembership('Current', ['Old.cs']),
    error => error instanceof AggregateError && error.errors.includes(failure));
  assert.deepEqual(seen, ['Current']);
});
