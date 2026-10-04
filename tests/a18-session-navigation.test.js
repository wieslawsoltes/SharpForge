import test from 'node:test';
import assert from 'node:assert/strict';
import {DockLayout, createGroup, createSplit} from '@sharpforge/docking';
import {DesignerDocuments} from '../apps/studio/designer-documents.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

/** Emits the focusin events caused by docking's remove/reinsert/focus sequence, without a renderer or global DOM. */
function focusDom() {
  const {document} = sessionDom();
  const createElement = document.createElement;
  document.createElement = tag => {
    const element = createElement(tag);
    Object.defineProperty(element, 'firstElementChild', {get: () => element.children[0] ?? null});
    element.removeAttribute = name => element.attributes.delete(name);
    element.contains = target => {
      for (let current = target; current; current = current.parentElement) {
        if (current === element) return true;
      }
      return false;
    };
    element.focus = () => {
      if (document.activeElement === element) return;
      document.activeElement = element;
      for (let current = element; current; current = current.parentElement) {
        for (const listener of current.listeners.get('focusin') ?? []) listener({target: element});
      }
    };
    return element;
  };
  return document;
}

function navigationHost({connect = () => Promise.resolve()} = {}) {
  const document = focusDom();
  const state = {active: 'A.cs', files: ['A.cs', 'B.cs'].map(uri => ({
    uri, text: 'class View { static Window Create() { return new Window(); } }'
  }))};
  const layout = new DockLayout(state.files.map(file => ({id: 'source:' + file.uri, kind: 'document'})), {
    version: 1,
    root: createSplit('documents', 'horizontal', createGroup('left', ['source:A.cs'], 'document'),
      createGroup('right', ['source:B.cs'], 'document')),
    floating: [], autoHide: {left: [], right: [], top: [], bottom: []}, closed: [], activePanel: 'source:A.cs'
  });
  const calls = [];
  const panels = new Map();
  const editors = new Map();
  const failures = [];
  const openSource = uri => documents.navigateSource(uri, () => {
    calls.push(uri);
    assert.ok(calls.length < 10, 'Source focus must not recursively reopen a document');
    state.active = uri;
    layout.open('source:' + uri);
    documents.activate(uri);
    return uri;
  });
  const documents = new DesignerDocuments({
    state, openSource, onError: error => failures.push(error),
    resolvePanel: id => {
      if (!panels.has(id)) panels.set(id, document.createElement('aside'));
      return panels.get(id);
    },
    createTools: (session, {panelResolver}) => {
      const scroller = document.createElement('div');
      return {
        scroller, initialized: true,
        ensure() { panelResolver('designer').append(scroller); },
        sourceSync: {connect: () => connect(session.uri), report() {}},
        resizeArtboard() {}, drawAdorners() {}, dispose() {}
      };
    }
  });
  for (const file of state.files) {
    const element = document.createElement('section');
    const input = document.createElement('textarea');
    input.value = file.text;
    input.setSelectionRange(3, 7);
    element.append(input);
    document.body.append(element);
    const editor = {input, focus: () => input.focus(), paint() {}};
    editors.set(file.uri, editor);
    documents.wrap(file.uri, element, editor);
  }
  // A remains visible in its own dock group when B opens. DockHost restores A's prior input focus after moving both roots.
  const unsubscribe = layout.subscribe(() => {
    const focused = document.activeElement;
    document.activeElement = document.body;
    focused?.focus();
  });
  return {document, documents, state, layout, calls, panels, editors, failures, openSource,
    ready: Promise.all([...documents.views.values()].map(view => view.ready)),
    dispose() { unsubscribe(); documents.dispose(); }
  };
}

test('opening another visible source group suppresses restored focus navigation and keeps editor, dock and tools on that URI', async () => {
  const host = navigationHost();
  await host.ready;
  const {documents, document, state, layout, calls, panels, editors} = host;
  const inputA = editors.get('A.cs').input;
  const inputB = editors.get('B.cs').input;
  inputA.focus();

  assert.equal(host.openSource('B.cs'), 'B.cs');

  assert.deepEqual(calls, ['B.cs']);
  assert.equal(state.active, 'B.cs');
  assert.equal(layout.snapshot().activePanel, 'source:B.cs');
  assert.equal(documents.active.uri, 'B.cs');
  assert.equal(document.activeElement, inputB);
  assert.ok([...panels.values()].every(panel => panel.dataset.designerUri === 'B.cs'));
  assert.equal(documents.sources.get('A.cs').editor.input, inputA);
  assert.deepEqual([inputA.selectionStart, inputA.selectionEnd], [3, 7]);
  assert.deepEqual(host.failures, []);
  host.dispose();
});

test('a later deliberate source focus changes the active document once and repeated activation does not reopen it', async () => {
  const host = navigationHost();
  await host.ready;
  host.editors.get('A.cs').focus();
  host.openSource('B.cs');
  host.calls.length = 0;

  host.editors.get('A.cs').focus();
  host.documents.activate('A.cs');

  assert.deepEqual(host.calls, ['A.cs']);
  assert.equal(host.state.active, 'A.cs');
  assert.equal(host.layout.snapshot().activePanel, 'source:A.cs');
  assert.equal(host.documents.active.uri, 'A.cs');
  assert.equal(host.document.activeElement, host.editors.get('A.cs').input);
  host.dispose();
});

test('navigation focuses the visible design surface without resetting a collapsed split or its ratio', async () => {
  const host = navigationHost();
  await host.ready;
  const view = host.documents.views.get('B.cs');
  view.session.setViewState({mode: 'split', collapsed: 'code', ratio: .3});
  host.editors.get('A.cs').focus();

  host.openSource('B.cs');

  assert.equal(host.document.activeElement, view.tools.scroller);
  assert.equal(view.codePane.hidden, true);
  assert.equal(view.session.viewState.mode, 'split');
  assert.equal(view.session.viewState.collapsed, 'code');
  assert.equal(view.session.viewState.ratio, .3);
  assert.deepEqual(host.calls, ['B.cs']);
  host.dispose();
});

test('source navigation preserves focus in the explorer instead of moving it to the editor', async () => {
  const host = navigationHost();
  await host.ready;
  const explorer = host.document.createElement('button');
  host.document.body.append(explorer);
  explorer.focus();

  host.openSource('B.cs');

  assert.equal(host.document.activeElement, explorer);
  assert.equal(host.documents.active.uri, 'B.cs');
  assert.deepEqual(host.calls, ['B.cs']);
  host.dispose();
});

test('source navigation releases its guard after both synchronous failure and rejected asynchronous navigation', async () => {
  const host = navigationHost();
  await host.ready;
  const failure = new Error('Source navigation failed');
  assert.throws(() => host.documents.navigateSource('B.cs', () => { throw failure; }), error => error === failure);
  assert.equal(host.documents.navigation, null);
  await assert.rejects(host.documents.navigateSource('B.cs', () => Promise.reject(failure)), error => error === failure);
  assert.equal(host.documents.navigation, null);

  host.editors.get('B.cs').focus();

  assert.deepEqual(host.calls, ['B.cs']);
  assert.equal(host.state.active, 'B.cs');
  assert.equal(host.documents.active.uri, 'B.cs');
  host.dispose();
});

test('an asynchronous navigation completion cannot replace a newer document selected while it was pending', async () => {
  const host = navigationHost();
  await host.ready;
  let resolve;
  const navigation = host.documents.navigateSource('A.cs', () => new Promise(done => { resolve = done; }));
  host.editors.get('B.cs').focus();
  resolve('completed A');

  assert.equal(await navigation, 'completed A');
  assert.equal(host.state.active, 'B.cs');
  assert.equal(host.documents.active.uri, 'B.cs');
  assert.equal(host.document.activeElement, host.editors.get('B.cs').input);
  assert.deepEqual(host.calls, ['B.cs']);
  host.dispose();
});

test('a delayed designer initialization applies its mode without taking focus from a later source navigation', async () => {
  let resolve;
  const initialization = new Promise(done => { resolve = done; });
  const host = navigationHost({connect: uri => uri === 'A.cs' ? initialization : Promise.resolve()});
  await host.documents.views.get('B.cs').ready;
  host.editors.get('A.cs').focus();
  const opening = host.documents.open('A.cs', 'design');
  await Promise.resolve();
  host.openSource('B.cs');
  resolve();

  await opening;

  assert.equal(host.documents.get('A.cs').viewState.mode, 'design');
  assert.equal(host.state.active, 'B.cs');
  assert.equal(host.layout.snapshot().activePanel, 'source:B.cs');
  assert.equal(host.documents.active.uri, 'B.cs');
  assert.equal(host.document.activeElement, host.editors.get('B.cs').input);
  assert.deepEqual(host.calls, ['A.cs', 'B.cs']);
  host.dispose();
});

test('document close, workspace reset and disposal invalidate pending navigation completions', async () => {
  for (const action of ['close', 'reset', 'dispose']) {
    const host = navigationHost();
    await host.ready;
    let resolve;
    const navigation = host.documents.navigateSource('A.cs', () => new Promise(done => { resolve = done; }));
    if (action === 'close') host.documents.close('A.cs');
    else host.documents[action]();
    resolve('finished');

    assert.equal(await navigation, 'finished');
    assert.equal(host.documents.navigation, null);
    assert.equal(host.documents.active, null);
    assert.equal(host.documents.size, action === 'close' ? 1 : 0);
    host.dispose();
  }
});
