import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { StudioWorkspaceInputs } from '../apps/studio/workbench/studio-workspace-inputs.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { readStudioFiles } from '../apps/studio/workbench/source-imports.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';
import { deferred, settle } from './a19-session-fixtures.js';

/** Native EventTarget dispatch with the minimal browser file-input properties used by the host. */
class FileInput extends EventTarget {
  constructor() {
    super();
    this.files = [];
    this.value = '';
    this.clicks = 0;
  }

  click() {
    this.clicks++;
    this.dispatchEvent(new Event('click'));
  }

  select(files) {
    this.files = files;
    this.value = files.length ? 'selected file' : '';
    this.dispatchEvent(new Event('change'));
  }

  cancel() { this.dispatchEvent(new Event('cancel')); }
}

function fixture(t) {
  const root = studioLoaderFixture(t);
  const tickets = [];
  const errors = [];
  const consumed = [];
  const begin = () => {
    const ticket = root.context.workspaceLoads.begin({ state: root.state, documents: root.services.documents });
    tickets.push(ticket);
    return ticket;
  };
  const inputs = new StudioWorkspaceInputs({ begin, onError: error => errors.push(error) });
  t.after(() => inputs.dispose());
  const consume = async (files, { load, signal }) => {
    consumed.push(files.map(file => file.name));
    const records = await readStudioFiles(files, { signal });
    return loadStudioWorkspace(records, { load, updateOnly: true }, root.context);
  };
  const bind = (input = new FileInput(), handler = consume) => { inputs.bind(input, handler); return input; };
  return { ...root, inputs, begin, tickets, errors, consumed, consume, bind };
}

const sourceFile = name => new File(['// ' + name], name, { type: 'text/plain' });

test('file picker opens synchronously exactly once and passes its original ticket into real workspace adoption', async t => {
  const current = fixture(t);
  const input = current.bind();
  let gestureActive = true;
  input.addEventListener('click', () => assert.equal(gestureActive, true));
  const opening = current.inputs.open(input);
  assert.equal(input.clicks, 1);
  assert.equal(current.tickets.length, 1);
  gestureActive = false;
  input.select([sourceFile('Selected.cs')]);
  await opening;
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['Selected.cs']);
  assert.equal(current.services.documents.require('Selected.cs').text, '// Selected.cs');
  assert.equal(current.tickets.length, 1);
  assert.equal(input.clicks, 1);
  assert.equal(input.value, '');
  assert.equal(getEventListeners(current.tickets[0].signal, 'abort').length, 0);
  assert.deepEqual(current.errors, []);
});

test('a superseded picker late change cannot invoke import or acquire a newer ticket', async t => {
  const current = fixture(t);
  const firstInput = current.bind();
  const secondInput = current.bind();
  const first = current.inputs.open(firstInput);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = current.inputs.open(secondInput);
  secondInput.select([sourceFile('Second.cs')]);
  await second;
  await rejected;
  firstInput.select([sourceFile('Obsolete.cs')]);
  await settle();
  assert.deepEqual(current.consumed, [['Second.cs']]);
  assert.equal(current.tickets.length, 2);
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['Second.cs']);
  assert.deepEqual(current.errors, []);
});

test('an uncancellable late reader keeps the original ticket and cannot replace a newer workspace', async t => {
  const current = fixture(t);
  const entered = deferred();
  const read = deferred();
  const exited = deferred();
  const firstInput = current.bind(new FileInput(), async (files, options) => {
    entered.resolve(options.load);
    try {
      const records = await read.promise;
      return await loadStudioWorkspace(records, { load: options.load, updateOnly: true }, current.context);
    } finally { exited.resolve(); }
  });
  const secondInput = current.bind();
  const first = current.inputs.open(firstInput);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  firstInput.select([sourceFile('Slow.cs')]);
  const oldTicket = await entered.promise;
  const prepared = await readStudioFiles([sourceFile('Slow.cs')]);
  const stagedModel = prepared[0].model;
  const second = current.inputs.open(secondInput);
  secondInput.select([sourceFile('New.cs')]);
  await second;
  assert.equal(oldTicket.signal.aborted, true);
  read.resolve(prepared);
  await exited.promise;
  await rejected;
  assert.throws(() => stagedModel.prepareEdits([]), /disposed/);
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['New.cs']);
  assert.equal(current.services.documents.require('New.cs').text, '// New.cs');
  assert.deepEqual(current.errors, []);
});

test('cancel removes the abort listener, releases an owned ticket, and permits a new picker', async t => {
  const current = fixture(t);
  const input = current.bind();
  const opening = current.inputs.open(input);
  const ticket = current.tickets[0];
  assert.equal(getEventListeners(ticket.signal, 'abort').length, 1);
  input.cancel();
  assert.equal(await opening, null);
  assert.equal(getEventListeners(ticket.signal, 'abort').length, 0);
  assert.throws(ticket.check, { name: 'AbortError' });
  const next = current.inputs.open(input);
  assert.equal(input.clicks, 2);
  input.select([sourceFile('AfterCancel.cs')]);
  await next;
  assert.deepEqual(current.consumed, [['AfterCancel.cs']]);
  assert.deepEqual(current.errors, []);
});

test('cancelling a borrowed ticket leaves ownership with the caller and creates no duplicate picker ticket', async t => {
  const current = fixture(t);
  const input = current.bind();
  const load = current.begin();
  const opening = current.inputs.open(input, { load });
  assert.equal(current.tickets.length, 1);
  assert.equal(input.clicks, 1);
  input.cancel();
  assert.equal(await opening, null);
  assert.equal(load.check(), true);
  assert.equal(getEventListeners(load.signal, 'abort').length, 0);
  load.finish();
  assert.deepEqual(current.consumed, []);
});

test('disposal rejects an open picker and removes all input and ticket listeners before late events', async t => {
  const current = fixture(t);
  const input = current.bind();
  const opening = current.inputs.open(input);
  const rejected = assert.rejects(opening, { name: 'AbortError' });
  const ticket = current.tickets[0];
  current.inputs.dispose();
  current.inputs.dispose();
  await rejected;
  assert.equal(getEventListeners(input, 'change').length, 0);
  assert.equal(getEventListeners(input, 'cancel').length, 0);
  assert.equal(getEventListeners(ticket.signal, 'abort').length, 0);
  input.select([sourceFile('Late.cs')]);
  input.cancel();
  await settle();
  assert.deepEqual(current.consumed, []);
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['Old.cs']);
  await assert.rejects(current.inputs.open(input));
  assert.equal(input.clicks, 1);
});

test('a direct nonempty input change begins once without opening a second native picker', async t => {
  const current = fixture(t);
  const completed = deferred();
  const input = current.bind(new FileInput(), async (files, options) => {
    try { return await current.consume(files, options); }
    finally { completed.resolve(); }
  });
  input.select([sourceFile('Direct.cs')]);
  await completed.promise;
  await settle();
  assert.equal(input.clicks, 0);
  assert.equal(current.tickets.length, 1);
  assert.deepEqual(current.consumed, [['Direct.cs']]);
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['Direct.cs']);
  assert.deepEqual(current.errors, []);
});

test('an empty unsolicited change cannot supersede an independent pending workspace operation', async t => {
  const current = fixture(t);
  const input = current.bind();
  const independent = current.begin();
  input.select([]);
  await settle();
  assert.equal(independent.check(), true);
  assert.equal(current.tickets.length, 1);
  assert.deepEqual(current.consumed, []);
  independent.finish();
});

test('read-only ownership rejects before opening the browser picker', async t => {
  const current = fixture(t);
  const input = current.bind();
  const session = current.services.sessions.create({ projectId: '$workspace', name: 'Running workspace' });
  session.state = 'running';
  session.emit('state');
  assert.equal(current.state.readOnly, true);
  await assert.rejects(current.inputs.open(input), { name: 'AbortError' });
  assert.equal(input.clicks, 0);
  assert.deepEqual(current.consumed, []);
});

test('consumer failure reports the actual error and releases its ticket without changing documents', async t => {
  const current = fixture(t);
  const failure = new Error('Unreadable selected source');
  const input = current.bind(new FileInput(), () => { throw failure; });
  const opening = current.inputs.open(input);
  const rejected = assert.rejects(opening, error => error === failure);
  input.select([sourceFile('Invalid.cs')]);
  await rejected;
  assert.equal(getEventListeners(current.tickets[0].signal, 'abort').length, 0);
  assert.throws(current.tickets[0].check, { name: 'AbortError' });
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['Old.cs']);
  const next = current.begin();
  assert.equal(next.check(), true);
  next.finish();
});
