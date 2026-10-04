import test from 'node:test';
import assert from 'node:assert/strict';
import {FileWatch} from '../apps/studio/workbench/file-watch.js';
import {deferred, diskObservationContext} from './fixtures/a19-disk-observation.js';

function watchContext(t, context) {
  const notices = [];
  const compared = [];
  const watch = new FileWatch({documents: context.documents, notify: item => notices.push(item),
    readDisk: (uri, options) => context.observer.read(uri, options),
    reload: (uri, text, options) => context.observer.reload(uri, text, options),
    compare: value => compared.push(value)});
  t.after(() => watch.dispose());
  return {watch, notices, compared};
}

test('A19 FileWatch forwards the captured record and observation and prompts once until the document or disk changes', async t => {
  const context = await diskObservationContext(t);
  const {watch, notices, compared} = watchContext(t, context);
  await watch.poll();
  assert.equal(notices.length, 0);
  context.external('external');
  await watch.poll();
  await watch.poll();
  assert.equal(notices.length, 1);
  notices[0].actions[2].run();
  assert.deepEqual(compared, [{uri: context.uri, current: 'original', disk: 'external'}]);
  assert.equal(await notices[0].actions[0].run(), true);
  assert.equal(context.documents.get(context.uri).text, 'external');
  assert.equal(context.disk.getVersion(context.uri), 2);
  await watch.poll();
  assert.equal(notices.length, 1);
});

test('A19 old Reload, Ignore, and Compare actions cannot act on a same-URI same-version replacement', async t => {
  const context = await diskObservationContext(t);
  const {watch, notices, compared} = watchContext(t, context);
  context.external('external');
  await watch.poll();
  const old = context.documents.get(context.uri);
  context.documents.replace([{uri: context.uri, text: 'replacement', version: old.version}], {discard: true});
  for (const action of notices[0].actions) assert.throws(() => action.run(), {code: 'SF-WB-FILE-WATCH-STALE'});
  assert.equal(compared.length, 0);
  await watch.poll();
  assert.equal(notices.length, 2);
  await notices[1].actions[0].run();
  assert.equal(context.documents.get(context.uri).text, 'external');
});

test('A19 a later edit refreshes the notification instead of retaining an unusable version guard forever', async t => {
  const context = await diskObservationContext(t);
  const {watch, notices} = watchContext(t, context);
  context.external('external');
  await watch.poll();
  context.documents.update(context.uri, 'new editor text');
  assert.throws(() => notices[0].actions[0].run(), {code: 'SF-WB-FILE-WATCH-STALE'});
  await watch.poll();
  assert.equal(notices.length, 2);
  await notices[1].actions[0].run();
  assert.equal(context.documents.get(context.uri).dirty, false);
});

test('A19 changing the Save As target invalidates every action even when the same document version remains open', async t => {
  const context = await diskObservationContext(t);
  const {watch, notices} = watchContext(t, context);
  context.external('external');
  await watch.poll();
  context.target = null;
  for (const action of notices[0].actions) assert.throws(() => action.run(), {code: 'SF-WB-FILE-WATCH-STALE'});
  assert.equal(context.documents.get(context.uri).text, 'original');
});

test('A19 a BOM-only external change is observable and its accepted metadata survives a later save', async t => {
  const context = await diskObservationContext(t);
  const {watch, notices} = watchContext(t, context);
  await watch.poll();
  context.external('original', {bom: true});
  await watch.poll();
  assert.equal(notices.length, 1);
  await notices[0].actions[0].run();
  assert.equal(context.documents.get(context.uri).bom, true);
  assert.equal(context.disk.byPath.get(context.uri).bom, true);
});

test('A19 a legacy asynchronous reader cannot publish a notification for a replaced document', async t => {
  const context = await diskObservationContext(t);
  const gate = deferred();
  const entered = deferred();
  const notices = [];
  const watch = new FileWatch({documents: context.documents, notify: item => notices.push(item),
    async readDisk() { entered.resolve(); await gate.promise; return 'external'; }});
  t.after(() => watch.dispose());
  const polling = watch.poll();
  await entered.promise;
  context.documents.replace([{uri: context.uri, text: 'replacement', version: 1}], {discard: true});
  gate.resolve();
  await polling;
  assert.equal(notices.length, 0);
  assert.equal(watch.baselines.size, 0);
});

test('A19 cancellation after a legacy reader resolves cannot publish an external-change notification', async t => {
  const context = await diskObservationContext(t);
  const controller = new AbortController();
  const notices = [];
  const watch = new FileWatch({documents: context.documents, notify: item => notices.push(item),
    async readDisk() { controller.abort(); return 'external'; }});
  t.after(() => watch.dispose());
  await assert.rejects(watch.poll({signal: controller.signal}), {name: 'AbortError'});
  assert.equal(notices.length, 0);
  assert.equal(watch.baselines.size, 0);
});
