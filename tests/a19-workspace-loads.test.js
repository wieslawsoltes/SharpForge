import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { WorkspaceLoads } from '../apps/studio/workbench/workspace-loads.js';

function fixture(t) {
  const state = { workspaceEpoch: 4, nativeMode: false, readOnly: false };
  const documents = new DocumentService({ records: [{ uri: 'Current.cs', text: 'original', version: 1 }] });
  const loads = new WorkspaceLoads();
  t.after(() => { loads.dispose(); documents.dispose(); });
  return { state, documents, loads };
}

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

async function adoptAfterRead(context, ticket, pending) {
  try {
    const record = await pending;
    ticket.check();
    context.documents.replace([record], { discard: true, signal: ticket.signal });
    context.state.workspaceEpoch++;
    return record.uri;
  } finally { ticket.finish(); }
}

test('a slow earlier read cannot replace a later workspace, even after the later ticket finishes', async t => {
  const context = fixture(t);
  const pending = deferred();
  const firstTicket = context.loads.begin(context);
  const first = adoptAfterRead(context, firstTicket, pending.promise);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const secondTicket = context.loads.begin(context);
  assert.equal(firstTicket.signal.aborted, true);
  assert.equal(await adoptAfterRead(context, secondTicket, { uri: 'Second.cs', text: 'second', version: 1 }), 'Second.cs');
  pending.resolve({ uri: 'First.cs', text: 'stale first', version: 1 });
  await rejected;
  assert.deepEqual(context.documents.list().map(record => record.uri), ['Second.cs']);
  assert.equal(context.documents.require('Second.cs').text, 'second');
});

test('an old finally cannot release or cancel the current request', t => {
  const context = fixture(t);
  const first = context.loads.begin(context);
  const second = context.loads.begin(context);
  first.finish();
  assert.equal(second.check(), true);
  const third = context.loads.begin(context);
  assert.equal(second.signal.aborted, true);
  assert.equal(third.check(), true);
  third.finish();
});

test('nested readers share the original ticket instead of beginning after their await', async t => {
  const context = fixture(t);
  const ticket = context.loads.begin(context);
  async function read(ticketForRead) {
    await Promise.resolve();
    ticketForRead.check();
    return { uri: 'Nested.cs', text: 'nested', version: 1 };
  }
  assert.equal(await adoptAfterRead(context, ticket, read(ticket)), 'Nested.cs');
  assert.equal(context.documents.require('Nested.cs').text, 'nested');
});

test('external cancellation rejects adoption and retains the original cancellation cause', async t => {
  const context = fixture(t);
  const controller = new AbortController();
  const pending = deferred();
  const ticket = context.loads.begin({ ...context, signal: controller.signal });
  const loading = adoptAfterRead(context, ticket, pending.promise);
  const cause = new Error('Caller stopped import');
  const rejected = assert.rejects(loading, error => error.name === 'AbortError' && error.cause === cause);
  controller.abort(cause);
  assert.equal(ticket.signal.aborted, true);
  pending.resolve({ uri: 'Cancelled.cs', text: 'discarded', version: 1 });
  await rejected;
  assert.equal(context.documents.require('Current.cs').text, 'original');
});

test('an already-cancelled request cannot begin reading or leave ownership behind', t => {
  const context = fixture(t);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => context.loads.begin({ ...context, signal: controller.signal }), { name: 'AbortError' });
  const ticket = context.loads.begin(context);
  assert.equal(ticket.check(), true);
  ticket.finish();
});

const changes = [
  ['document edit', context => context.documents.update('Current.cs', 'keep this edit')],
  ['document replacement', context => context.documents.replace([{ uri: 'Other.cs', text: 'keep replacement' }], { discard: true })],
  ['workspace epoch', context => context.state.workspaceEpoch++],
  ['native backend', context => { context.state.nativeMode = true; }],
  ['read-only transition', context => { context.state.readOnly = true; }],
  ['document disposal', context => context.documents.dispose()]
];

for (const [label, change] of changes) {
  test('ownership check cancels after ' + label + ' without undoing the current workspace', t => {
    const context = fixture(t);
    const ticket = context.loads.begin(context);
    change(context);
    const revision = context.documents.revision;
    const epoch = context.state.workspaceEpoch;
    const records = [...context.documents.list()];
    assert.throws(ticket.check, { name: 'AbortError' });
    assert.equal(ticket.signal.aborted, true);
    assert.equal(context.documents.revision, revision);
    assert.equal(context.state.workspaceEpoch, epoch);
    assert.deepEqual(context.documents.list(), records);
    ticket.finish();
  });
}

test('begin rejects a locked workspace and a disposed document service', t => {
  const context = fixture(t);
  context.state.readOnly = true;
  assert.throws(() => context.loads.begin(context), { name: 'AbortError' });
  context.state.readOnly = false;
  context.documents.dispose();
  assert.throws(() => context.loads.begin(context), { name: 'AbortError' });
});

test('disposal cancels pending I/O, prevents adoption, and is idempotent', async t => {
  const context = fixture(t);
  const pending = deferred();
  const ticket = context.loads.begin(context);
  const loading = adoptAfterRead(context, ticket, pending.promise);
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  context.loads.dispose();
  context.loads.dispose();
  assert.equal(ticket.signal.aborted, true);
  assert.throws(() => context.loads.begin(context), { name: 'AbortError' });
  pending.resolve({ uri: 'Disposed.cs', text: 'discarded', version: 1 });
  await rejected;
  assert.equal(context.documents.require('Current.cs').text, 'original');
});

test('finish detaches external cancellation and a finished ticket cannot be reused', t => {
  const context = fixture(t);
  const controller = new AbortController();
  const ticket = context.loads.begin({ ...context, signal: controller.signal });
  const { check, finish } = ticket;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  assert.equal(check(), true);
  finish();
  finish();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assert.equal(ticket.signal.aborted, false);
  assert.throws(check, { name: 'AbortError' });
  const next = context.loads.begin(context);
  assert.equal(next.check(), true);
  next.finish();
});

test('independent Studio instances do not cancel each other', t => {
  const firstContext = fixture(t);
  const secondContext = fixture(t);
  const first = firstContext.loads.begin(firstContext);
  const second = secondContext.loads.begin(secondContext);
  firstContext.loads.dispose();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.check(), true);
  second.finish();
});

test('a reentrant abort listener cannot restore an older owner over a newer request', t => {
  const context = fixture(t);
  const first = context.loads.begin(context);
  const controller = new AbortController();
  let newest;
  first.signal.addEventListener('abort', () => { newest = context.loads.begin(context); }, { once: true });
  assert.throws(() => context.loads.begin({ ...context, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(newest.check(), true);
  const final = context.loads.begin(context);
  assert.equal(newest.signal.aborted, true);
  assert.equal(final.check(), true);
  final.finish();
});

test('invalid arguments do not supersede a valid pending request', t => {
  const context = fixture(t);
  const ticket = context.loads.begin(context);
  assert.throws(() => context.loads.begin(), TypeError);
  assert.throws(() => context.loads.begin({ ...context, signal: {} }), TypeError);
  assert.equal(ticket.check(), true);
  ticket.finish();
});
