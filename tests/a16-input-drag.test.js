import test from 'node:test';
import assert from 'node:assert/strict';
import { DragDropManager, DropFileBroker, DragServices, validateDragData, readDragData,
  serializeRoutedEvent } from '../packages/winui-controls/src/input/index.js';

function transfer(values = {}) {
  const data = new Map(Object.entries(values));
  return { types: [...data.keys()], files: [], effectAllowed: 'all', dropEffect: 'none',
    getData: format => data.get(format) ?? '', setData(format, value) { data.set(format, value); }, data };
}
function event(dataTransfer) { return { dataTransfer, prevented: false, preventDefault() { this.prevented = true; } }; }
const packageData = text => ({ version: 1, values: [['Text', text]], requestedOperation: 1 });

test('text drag routes from child hit to AllowDrop ancestor with typed operation and cloneable data', () => {
  const nodes = new Map([['source', { properties: { CanDrag: true } }], ['target', { properties: { AllowDrop: true } }],
    ['child', { properties: {} }]]);
  const seen = [];
  const manager = new DragDropManager({ resolve: id => nodes.get(id), parentOf: id => id === 'child' ? 'target' : null,
    emit(id, name, args) {
      seen.push({ id, name, wire: serializeRoutedEvent(args) });
      if (name === 'DragStarting') args.Data = packageData('one \u{1f600} two');
      if (name === 'DragOver' || name === 'Drop') args.AcceptedOperation = 1;
    } });
  const data = transfer(), start = event(data);
  manager.handle('dragstart', 'source', start, { x: 2, y: 3 });
  assert.equal(data.data.get('text/plain'), 'one \u{1f600} two');
  manager.handle('dragover', 'child', event(data), { x: 10, y: 20 });
  assert.equal(data.dropEffect, 'copy');
  manager.handle('drop', 'child', event(data), { x: 10, y: 20 });
  const drop = seen.find(value => value.name === 'Drop');
  assert.equal(drop.id, 'target');
  assert.deepEqual(drop.wire.DataView.values, [['Text', 'one \u{1f600} two']]);
  assert.deepEqual(structuredClone(drop.wire), drop.wire);
  manager.handle('dragend', 'source', event(data), { x: 10, y: 20 });
  assert.equal(seen.at(-1).wire.DropResult, 1);
  manager.dispose();
});

test('managed drag replies update private internal data while stale/foreign replies cannot redirect targets', () => {
  const manager = new DragDropManager({ resolve: id => ({ properties: id === 'source' ? { CanDrag: true } : { AllowDrop: true } }) });
  const data = transfer();
  manager.handle('dragstart', 'source', event(data), { x: 0, y: 0 });
  const session = manager.current.id;
  manager.reply({ id: 'source', session, event: 'DragStarting', data: packageData('worker text'), allowedOperations: 3 });
  assert.equal(data.getData('text/plain'), '');
  assert.equal(manager.current.data.values[0][1], 'worker text');
  assert.throws(() => manager.reply({ id: 'other', session, event: 'DragStarting', data: packageData('wrong') }), /mismatch/);
  manager.handle('dragover', 'target', event(data), { x: 4, y: 5 });
  assert.equal(manager.reply({ id: 'other', session, event: 'DragOver', acceptedOperation: 1 }), false);
  manager.reply({ id: 'target', session, event: 'DragOver', acceptedOperation: 2 });
  assert.equal(manager.current.accepted, 2);
  manager.removeNode('source');
  assert.equal(manager.reply({ id: 'source', session, event: 'DragStarting' }), false);
});

test('file capability is private, permission-gated, bounded, single-use and isolated between hosts', async () => {
  let reads = 0, granted = false, time = 0;
  const token = 'a'.repeat(32);
  const broker = new DropFileBroker({ createToken: () => token, now: () => time, lifetime: 100,
    policy: { authorize: async (name, detail) => { assert.equal(name, 'storage-items-drop'); assert.equal(detail.count, 1); return granted; } },
    readFiles: async files => { reads++; return files.map(file => ({ id: 'file:1', name: file.name, contentType: 'text/plain',
      size: file.size, lastModified: 0 })); } });
  broker.capture([{ name: 'note.txt', size: 10 }]);
  await assert.rejects(broker.read(token), /denied/);
  assert.equal(reads, 0);
  granted = true;
  broker.capture([{ name: 'note.txt', size: 10 }]);
  const other = new DropFileBroker();
  await assert.rejects(other.read(token), /another host/);
  const result = await broker.read(token);
  assert.equal(result[0].name, 'note.txt');
  assert.deepEqual(structuredClone(result), result);
  assert.equal(reads, 1);
  await assert.rejects(broker.read(token), /expired/);
  broker.capture([{ name: 'note.txt', size: 10 }]); time = 101;
  await assert.rejects(broker.read(token), /expired/);
  broker.dispose(); other.dispose();
});

test('drop data rejects oversized text, unsafe URIs, malformed storage results and absent file adapters', async () => {
  assert.throws(() => validateDragData(packageData('x'.repeat(32769))), /byte limit/);
  assert.throws(() => validateDragData({ version: 1, values: [['Uri', 'javascript:alert(1)']] }), /Unsupported/);
  assert.throws(() => validateDragData({ version: 1, values: [['Text', 'a'], ['Text', 'b']] }), /format/);
  const data = transfer({ 'text/plain': 'value', 'text/html': '<b>value</b>' });
  const snapshot = readDragData(data);
  assert.equal(snapshot.values.length, 2);
  data.types.push('Files'); data.files = [{ name: 'a', size: 1 }];
  const broker = new DropFileBroker({ createToken: () => 'b'.repeat(32) });
  const drop = readDragData(data, { files: broker, captureFiles: true });
  assert.deepEqual(drop.externalFormats, ['StorageItems']);
  assert.equal('files' in drop, false);
  await assert.rejects(broker.read(drop.StorageToken), /explicit permission/);
  broker.dispose();
});

test('managed drag deferrals emit one reply after completion and reject double Complete', () => {
  const packets = [];
  const service = new DragServices({ id: value => value }, { send: packet => packets.push(packet) });
  const payload = { DragSession: 'drag-1', DragEvent: 'DragStarting', OriginalSource: 'source', Data: packageData('before'),
    AllowedOperations: 3, DragUI: {} };
  const deferral = service.getDeferral(payload);
  service.completeEvent('DragStarting', payload);
  assert.equal(packets.length, 0);
  payload.Data = packageData('after');
  deferral.Complete();
  assert.equal(packets.length, 1);
  assert.equal(packets[0].data.values[0][1], 'after');
  assert.throws(() => deferral.Complete(), /already completed/);
});
