import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearchController} from '../apps/studio/tools/workspace-search.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return {promise, resolve, reject};
}

function setup(record = {path: 'A.cs', text: 'find this', version: 3}) {
  let context = {identity: 'one', revision: 7, disk: {}, records: [record]};
  const requests = [];
  const states = [];
  const opened = [];
  const loads = [];
  const controller = new WorkspaceSearchController({context: () => context, show: state => states.push(state),
    request: (method, params) => { const pending = deferred(); requests.push({method, params, ...pending}); return pending.promise; },
    load: (path, options) => { const pending = deferred(); loads.push({path, options, ...pending}); return pending.promise; },
    open: (...args) => opened.push(args)});
  return {controller, requests, states, opened, loads, get context() { return context; },
    set context(value) { context = value; }, get last() { return states.at(-1); }};
}

function result(version = 3, overrides = {}) {
  return {matches: [{uri: 'A.cs', start: 0, end: 4, line: 0, preview: 'find this', version, ...overrides}], truncated: false};
}

async function search(app, query = 'find', options = {}, matches = result()) {
  const pending = app.controller.search(query, options);
  app.requests.at(-1).resolve(matches);
  return pending;
}

test('a superseded search cannot replace newer results with either a late success or failure', async () => {
  for (const failure of [false, true]) {
    const app = setup();
    const old = app.controller.search('old');
    const current = app.controller.search('find');
    assert.equal(app.requests[0].params.signal.aborted, true);
    app.requests[1].resolve(result());
    const binding = await current;
    if (failure) app.requests[0].reject(new Error('late old failure'));
    else app.requests[0].resolve(result(3, {preview: 'old result'}));
    assert.equal(await old, null);
    assert.equal(app.last.kind, 'results');
    assert.equal(app.last.result, binding);
    app.controller.dispose();
  }
});

test('workspace identity, disk replacement and revision changes fence successful and failed search completions', async () => {
  for (const replacement of [{identity: 'two'}, {disk: {}}, {revision: 8}]) {
    for (const failure of [false, true]) {
      const app = setup();
      const pending = app.controller.search('find');
      app.context = {...app.context, ...replacement};
      if (failure) app.requests[0].reject(new Error('late failure'));
      else app.requests[0].resolve(result());
      assert.equal(await pending, null);
      assert.equal(app.last.kind, 'stale');
      assert.match(app.last.message, /Search again/);
      app.controller.dispose();
    }
  }
});

test('loaded matches require their captured version, membership and exact literal span before opening', async () => {
  for (const mutation of [record => ({...record, version: 4}), record => ({...record, text: 'lost this'}), () => null]) {
    const app = setup();
    const binding = await search(app);
    const changed = mutation(app.context.records[0]);
    app.context.records = changed ? [changed] : [];
    assert.equal(await app.controller.navigate(binding, 0), false);
    assert.deepEqual(app.opened, []);
    assert.equal(app.last.kind, 'stale');
    assert.match(app.last.message, /Search again/);
  }
});

test('legacy results without a version bind to the captured document watermark', async () => {
  const app = setup();
  const binding = await search(app, 'find', {}, result(3, {version: undefined}));
  assert.equal(binding.matches[0].version, 3);
  assert.equal(await app.controller.navigate(binding, 0), true);
  assert.deepEqual(app.opened, [['A.cs', 0, 4]]);
  app.controller.dispose();
});

test('guarded lazy admission may advance the version and repeated navigation uses that admitted watermark', async () => {
  const app = setup({path: 'A.cs', lazy: true, size: 9});
  const binding = await search(app, 'find', {}, result(0));
  const pending = app.controller.navigate(binding, 0);
  assert.equal(app.loads[0].path, 'A.cs');
  assert.equal(app.loads[0].options.signal.aborted, false);
  const loaded = {path: 'A.cs', text: 'find this', version: 1};
  app.context.records = [loaded];
  app.loads[0].resolve(loaded);
  assert.equal(await pending, true);
  assert.equal(await app.controller.navigate(binding, 0), true);
  assert.equal(app.loads.length, 1);
  assert.deepEqual(app.opened, [['A.cs', 0, 4], ['A.cs', 0, 4]]);
  app.controller.dispose();
});

test('new lazy bytes must still contain the searched text at its reported UTF-16 offset', async () => {
  const app = setup({path: 'A.cs', lazy: true, size: 9, version: 4});
  const binding = await search(app, 'find', {}, result(4));
  const pending = app.controller.navigate(binding, 0);
  const loaded = {path: 'A.cs', text: 'now find this', version: 5};
  app.context.records = [loaded];
  app.loads[0].resolve(loaded);
  assert.equal(await pending, false);
  assert.deepEqual(app.opened, []);
  assert.match(app.last.message, /current location/);
});

test('workspace replacement, edits, cancellation and a newer query prevent navigation after lazy I/O', async () => {
  for (const action of ['workspace', 'revision', 'cancel', 'query', 'dispose']) {
    const app = setup({path: 'A.cs', lazy: true, size: 9, version: 0});
    const binding = await search(app, 'find', {}, result(0));
    const pending = app.controller.navigate(binding, 0);
    if (action === 'workspace') app.context = {...app.context, identity: 'two'};
    if (action === 'revision') app.context.revision++;
    if (action === 'cancel') app.controller.cancel();
    if (action === 'dispose') app.controller.dispose();
    const newer = action === 'query' ? app.controller.search('new') : null;
    const loaded = {path: 'A.cs', text: 'find this', version: 1};
    app.context.records = [loaded];
    app.loads[0].resolve(loaded);
    assert.equal(await pending, false);
    assert.deepEqual(app.opened, []);
    if (['cancel', 'query', 'dispose'].includes(action)) assert.equal(app.loads[0].options.signal.aborted, true);
    if (newer) { app.requests.at(-1).resolve({matches: [], truncated: false}); await newer; }
    app.controller.dispose();
  }
});

test('case-insensitive and whole-word navigation uses Unicode boundaries without losing UTF-16 offsets', async () => {
  const text = '😀 FIND!';
  const app = setup({path: 'A.cs', text, version: 3});
  const binding = await search(app, 'find', {wholeWord: true}, result(3, {start: 3, end: 7}));
  assert.equal(await app.controller.navigate(binding, 0), true);
  assert.deepEqual(app.opened, [['A.cs', 3, 7]]);
  const second = setup({path: 'A.cs', text: '𝒜find!', version: 3});
  const invalid = await search(second, 'find', {wholeWord: true}, result(3, {start: 2, end: 6}));
  assert.equal(await second.controller.navigate(invalid, 0), false);
  assert.deepEqual(second.opened, []);
});

test('retained result buttons and replacement intents are invalidated on workspace observation and disposal', async () => {
  const app = setup();
  const old = await search(app);
  const intent = app.controller.capture();
  app.context = {...app.context, identity: 'two'};
  app.controller.observe();
  assert.equal(app.last.kind, 'stale');
  assert.equal(app.controller.isCurrent(intent), false);
  assert.equal(app.controller.sameIdentity(intent), false);
  assert.equal(await app.controller.navigate(old, 0), false);
  const pending = app.controller.search('find');
  const count = app.states.length;
  app.controller.dispose();
  app.requests.at(-1).reject(new Error('disposed request'));
  assert.equal(await pending, null);
  assert.equal(app.states.length, count);
});
