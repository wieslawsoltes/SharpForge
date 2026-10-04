import test from 'node:test';
import assert from 'node:assert/strict';
import {DockLayout} from '@sharpforge/docking';
import {DocumentTabs} from '../apps/studio/workbench/tabs/index.js';
import {WorkbenchNavigation} from '../apps/studio/workbench/navigation/index.js';
import {StudioNavigation} from '../apps/studio/workbench/studio-navigation.js';
import {TestDocuments} from './support/a19-documents.js';

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

class DelayedDocuments extends TestDocuments {
  constructor() {
    super(['B.cs']);
    this.delays = new Map();
    this.opened = [];
  }

  delay(uri) {
    const wait = {entered: gate(), release: gate()};
    this.delays.set(uri, wait);
    return wait;
  }

  async open(uri, options) {
    this.opened.push(uri);
    const wait = this.delays.get(uri);
    if (wait) {
      this.delays.delete(uri);
      wait.entered.resolve();
      await wait.release.promise;
    }
    return super.open(uri, options);
  }
}

async function fixture(t, prepare, documents = new TestDocuments(['B.cs'])) {
  const layout = new DockLayout();
  const tabs = new DocumentTabs({layout, documents});
  await tabs.open('B.cs');
  const menus = [];
  const focused = [];
  const host = {popouts: new Map(), focusPanel: id => focused.push(id), showMenu: items => menus.push(items)};
  const navigation = new WorkbenchNavigation({tabs, host});
  const docking = {layout, tabs, host, navigation};
  navigation.record({uri: 'A.cs', start: 7, end: 9, viewId: 'split', scrollTop: 120});
  navigation.record({uri: 'B.cs', start: 12});
  documents.restoreViewState('B.cs', {start: 12, end: 12});
  const adapter = new StudioNavigation({docking, getEditor: () => null,
    prepareDocument: (uri, options) => prepare(uri, options, documents)});
  t.after(() => { adapter.dispose(); tabs.dispose(); });
  return {layout, documents, tabs, navigation, adapter, menus, focused};
}

function admit(documents, uri) {
  if (!documents.get(uri)) documents.records.set(uri, {uri, text: '// restored', version: 1, dirty: false});
  return documents.get(uri);
}

test('direct and toolbar navigation share queued lazy admission and preserve view locations', async t => {
  const entered = gate(), release = gate();
  const f = await fixture(t, async (uri, {signal}, documents) => {
    if (uri === 'A.cs') { entered.resolve(); await release.promise; }
    signal.throwIfAborted();
    return admit(documents, uri);
  });
  const back = f.navigation.back();
  await entered.promise;
  const forward = f.adapter.forward();
  assert.equal(f.navigation.history.index, 1);
  assert.equal(f.navigation.replaying, false);
  assert.equal(f.documents.get('A.cs'), undefined);
  release.resolve();
  const backPanel = await back;
  const forwardPanel = await forward;
  assert.equal(f.tabs.metadata(backPanel).uri, 'A.cs');
  assert.equal(f.tabs.metadata(backPanel).viewId, 'split');
  assert.equal(f.tabs.metadata(forwardPanel).uri, 'B.cs');
  assert.equal(f.documents.getViewState('A.cs', 'split').start, 7);
  assert.equal(f.documents.getViewState('A.cs', 'split').scrollTop, 120);
  assert.equal(f.navigation.history.entries.length, 2);
  assert.equal(f.navigation.history.index, 1);
});

test('failed and unavailable admission leave the history index intact and release the navigation queue', async t => {
  let mode = 'fail';
  const f = await fixture(t, async (uri, options, documents) => {
    if (mode === 'fail') throw new Error('Folder permission revoked');
    if (mode === 'missing') return null;
    return admit(documents, uri);
  });
  const before = f.adapter.snapshot();
  await assert.rejects(f.adapter.back(), /permission revoked/);
  assert.deepEqual(f.adapter.snapshot(), before);
  mode = 'missing';
  assert.equal(await f.adapter.back(), null);
  assert.deepEqual(f.adapter.snapshot(), before);
  mode = 'ready';
  f.adapter.menu(0, 0);
  await f.menus[0].find(item => item.id === 'navigate:0').execute();
  assert.equal(f.navigation.history.index, 0);
  assert.equal(f.documents.getViewState('A.cs', 'split').end, 9);
});

test('clearing a workspace cancels in-flight source preparation before history or tabs can be adopted', async t => {
  const entered = gate(), release = gate();
  let signal;
  const f = await fixture(t, async (uri, options, documents) => {
    signal = options.signal;
    entered.resolve();
    await release.promise;
    signal.throwIfAborted();
    return admit(documents, uri);
  });
  const pending = f.adapter.back();
  await entered.promise;
  f.adapter.clear();
  assert.equal(signal.aborted, true);
  const cancelled = assert.rejects(pending, {name: 'AbortError'});
  release.resolve();
  await cancelled;
  assert.equal(f.documents.get('A.cs'), undefined);
  assert.equal(f.navigation.history.entries.length, 0);
  assert.equal(f.navigation.replaying, false);
});

test('a new foreground location during lazy preparation is preserved instead of replaying an obsolete target', async t => {
  const entered = gate(), release = gate();
  const f = await fixture(t, async (uri, options, documents) => {
    entered.resolve();
    await release.promise;
    return admit(documents, uri);
  });
  const pending = f.adapter.back();
  await entered.promise;
  f.navigation.record({uri: 'B.cs', start: 30});
  release.resolve();
  assert.equal(await pending, null);
  assert.equal(f.navigation.history.current.start, 30);
  assert.equal(f.navigation.history.entries.length, 3);
  assert.equal(f.layout.state.activePanel, 'source:B.cs');
});

test('clearing after preparation fences a delayed document open before tab admission and focus', async t => {
  const documents = new DelayedDocuments();
  const wait = documents.delay('A.cs');
  const f = await fixture(t, (uri, options, records) => admit(records, uri), documents);
  const pending = f.navigation.back();
  await wait.entered.promise;
  assert.equal(f.navigation.replaying, false);
  f.adapter.clear();
  wait.release.resolve();
  assert.equal(await pending, null);
  assert.equal(f.tabs.list().length, 1);
  assert.equal(f.layout.state.activePanel, 'source:B.cs');
  assert.deepEqual(f.focused, []);
  assert.equal(f.navigation.history.entries.length, 0);
});

test('foreground history supersedes a replay waiting for a document', async t => {
  const documents = new DelayedDocuments();
  const wait = documents.delay('A.cs');
  const f = await fixture(t, (uri, options, records) => admit(records, uri), documents);
  const pending = f.navigation.back();
  await wait.entered.promise;
  f.navigation.record({uri: 'B.cs', start: 30});
  wait.release.resolve();
  assert.equal(await pending, null);
  assert.equal(f.navigation.history.current.start, 30);
  assert.equal(f.navigation.history.entries.length, 3);
  assert.equal(f.tabs.list().some(id => f.tabs.metadata(id).uri === 'A.cs'), false);
  assert.equal(f.layout.state.activePanel, 'source:B.cs');
  assert.deepEqual(f.focused, []);
});

test('a later queued tab request supersedes navigation without an intervening history update', async t => {
  const documents = new DelayedDocuments();
  const wait = documents.delay('A.cs');
  const f = await fixture(t, (uri, options, records) => admit(records, uri), documents);
  const pending = f.navigation.back();
  await wait.entered.promise;
  admit(documents, 'C.cs');
  const foreground = f.tabs.open('C.cs');
  wait.release.resolve();
  assert.equal(await pending, null);
  assert.equal(await foreground, 'source:C.cs');
  assert.equal(f.navigation.history.index, 1);
  assert.equal(f.tabs.list().some(id => f.tabs.metadata(id).uri === 'A.cs'), false);
  assert.equal(f.layout.state.activePanel, 'source:C.cs');
  assert.deepEqual(f.focused, []);
});

test('the admission token still fences a newer request during the promise handoff', async t => {
  const f = await fixture(t, (uri, options, records) => admit(records, uri));
  admit(f.documents, 'C.cs');
  let foreground;
  const requested = gate();
  const off = f.layout.subscribe(event => {
    if (event.type !== 'openDocument') return;
    off();
    queueMicrotask(() => {
      foreground = f.tabs.open('C.cs');
      requested.resolve();
    });
  });
  t.after(off);
  const pending = f.navigation.back();
  await requested.promise;
  assert.equal(await pending, null);
  await foreground;
  assert.equal(f.navigation.history.index, 1);
  assert.equal(f.layout.state.activePanel, 'source:C.cs');
  assert.deepEqual(f.focused, []);
});

test('activation away and back still supersedes an older delayed navigation', async t => {
  const documents = new DelayedDocuments();
  const f = await fixture(t, (uri, options, records) => admit(records, uri), documents);
  admit(documents, 'C.cs');
  const other = await f.tabs.open('C.cs');
  f.tabs.activate('source:B.cs');
  const wait = documents.delay('A.cs');
  const pending = f.navigation.back();
  await wait.entered.promise;
  f.tabs.activate(other);
  f.tabs.activate('source:B.cs');
  wait.release.resolve();
  assert.equal(await pending, null);
  assert.equal(f.navigation.history.index, 1);
  assert.equal(f.layout.state.activePanel, 'source:B.cs');
  assert.equal(f.tabs.list().some(id => f.tabs.metadata(id).uri === 'A.cs'), false);
  assert.deepEqual(f.focused, []);
});

test('disposing preparation while its tab request is queued prevents the document open itself', async t => {
  const documents = new DelayedDocuments();
  const prepared = gate();
  const f = await fixture(t, (uri, options, records) => {
    prepared.resolve();
    return admit(records, uri);
  }, documents);
  admit(documents, 'C.cs');
  const wait = documents.delay('C.cs');
  const foreground = f.tabs.open('C.cs');
  await wait.entered.promise;
  const pending = f.navigation.back();
  await prepared.promise;
  await Promise.resolve();
  f.adapter.dispose();
  wait.release.resolve();
  await foreground;
  assert.equal(await pending, null);
  assert.equal(documents.opened.includes('A.cs'), false);
  assert.equal(f.layout.state.activePanel, 'source:C.cs');
  assert.deepEqual(f.focused, []);
});

test('an old cancelled replay cannot release a newer replay owner', async t => {
  const documents = new DelayedDocuments();
  const wait = documents.delay('A.cs');
  const f = await fixture(t, (uri, options, records) => admit(records, uri), documents);
  const old = f.navigation.back();
  await wait.entered.promise;
  f.adapter.clear();
  f.navigation.record({uri: 'A.cs', start: 40});
  f.navigation.record({uri: 'B.cs', start: 12});
  const next = f.navigation.back();
  await Promise.resolve();
  await Promise.resolve();
  wait.release.resolve();
  assert.equal(await old, null);
  const panel = await next;
  assert.equal(f.tabs.metadata(panel).uri, 'A.cs');
  assert.equal(f.documents.getViewState('A.cs').start, 40);
  assert.equal(f.navigation.history.index, 0);
  assert.deepEqual(f.focused, [panel]);
  assert.equal(f.navigation.replaying, false);
});
