import test from 'node:test';
import assert from 'node:assert/strict';
import {copyDestination, registerClipboardCommands} from '../apps/studio/explorer/clipboard.js';
import {ExplorerDragDrop} from '../apps/studio/explorer/drag-drop.js';
import {inspectMoveBatch, confirmMoveBatch} from '../apps/studio/explorer/guards.js';

test('copy naming uses portable identity while preserving spelling, suffixes and directory locations', () => {
  assert.equal(copyDestination('Src/A.cs', new Set(['src/a.CS', 'Src/A - Copy.cs'])), 'Src/A - Copy (2).cs');
  assert.equal(copyDestination('cafe\u0301.txt', new Set(['café.txt'])), 'cafe\u0301 - Copy.txt');
  assert.equal(copyDestination('.editorconfig', new Set(['.editorconfig'])), '.editorconfig - Copy');
  assert.equal(copyDestination('unused.bin', new Set()), 'unused.bin');
});

test('clipboard commands retain a workspace identity and clear a cut only after successful admission', async () => {
  const registry = new Map();
  registerClipboardCommands(registry);
  const context = {identity: 'first', records: [{path: 'Src/A.cs', text: 'class A {}'}], folders: ['Dest']};
  const moves = [];
  const commands = {registry, files: nodes => nodes.filter(node => node.kind === 'source'), host: {notice() {}},
    move: async (...args) => { moves.push(args); return {completed: []}; }};
  const nodes = [{kind: 'source', path: 'Src/A.cs', children: [{id: 'symbol'}]}];
  await registry.get('cut').execute({commands, context, nodes});
  assert.equal(commands.clipboard.nodes[0].children, undefined);
  const paste = next => registry.get('paste').execute({commands, context: next, node: {kind: 'folder', path: 'Dest'}});
  await assert.rejects(paste({...context, identity: 'second'}), /another workspace/);
  assert.deepEqual(moves, []);
  await paste(context);
  assert(commands.clipboard, 'cancelled/empty movement must retain the clipboard');
  assert.deepEqual(moves[0][0], [{from: 'Src/A.cs', to: 'Dest/A.cs'}]);
  assert.equal(moves[0][1], false);
  commands.move = async mappings => ({completed: mappings});
  await paste(context);
  assert.equal(commands.clipboard, null);
});

test('move admission reports invalid members and requires explicit confirmation before returning a partial batch', async () => {
  const context = {records: [{path: 'A.cs'}, {path: 'B.cs'}], folders: []};
  const results = inspectMoveBatch(context, [{from: 'A.cs', to: 'Dest/A.cs'}, {from: 'B.cs', to: '../outside.cs'}]);
  assert.deepEqual(results.map(value => value.status), ['ready', 'rejected']);
  const notices = [];
  const host = {confirm: async () => false, notice: text => notices.push(text)};
  assert.deepEqual(await confirmMoveBatch(host, results), []);
  host.confirm = async () => true;
  assert.deepEqual((await confirmMoveBatch(host, results)).map(value => value.from), ['A.cs']);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /B.cs/);
  const nested = inspectMoveBatch({records: [{path: 'Src/A.cs'}]},
    [{from: 'Src', to: 'Dest'}, {from: 'Src/A.cs', to: 'Other.cs'}]);
  assert.equal(nested[1].status, 'rejected');
  const readOnly = inspectMoveBatch({...context, readOnly: true}, [{from: 'A.cs', to: 'New.cs'}]);
  await assert.rejects(confirmMoveBatch(host, readOnly), /Stop debugging/);
});

function dragFixture() {
  const listeners = new Map();
  const row = {dataset: {treeId: 'target'}};
  const element = {contains: node => node === row,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); }};
  const target = {id: 'target', kind: 'folder', path: 'App/Links', project: 'App/App.csproj'};
  const source = {id: 'source', kind: 'source', path: 'Shared/A.cs'};
  const calls = [], errors = [];
  const model = {nodes: new Map([['target', target], ['source', source]])};
  const drop = new ExplorerDragDrop({element, model, treeId: 'test',
    onCommand: (...args) => calls.push(args), onError: error => errors.push(error.message)});
  const event = {target: {closest: () => row}, ctrlKey: true, shiftKey: true, preventDefault() {}, stopImmediatePropagation() {},
    dataTransfer: {types: ['application/x-sharpforge-tree'], getData: () => JSON.stringify({tree: 'test', ids: ['source']})}};
  return {drop, calls, errors, listeners, event, model, target, source};
}

test('modifier link drops resolve current model nodes and dispose unregisters the exact listeners', async () => {
  const app = dragFixture();
  app.drop.dragOver(app.event);
  assert.equal(app.event.dataTransfer.dropEffect, 'link');
  await app.listeners.get('drop')(app.event);
  assert.deepEqual(app.calls, [['link-to', app.target, [app.source]]]);
  assert.deepEqual(app.errors, []);
  app.drop.dispose();
  assert.equal(app.listeners.size, 0);
});

test('drop transport rejects stale, foreign, oversized and non-container targets without dispatch', async () => {
  for (const kind of ['stale', 'foreign', 'large', 'target']) {
    const app = dragFixture();
    if (kind === 'stale') app.model.nodes.delete('source');
    if (kind === 'foreign') app.event.dataTransfer.getData = () => JSON.stringify({tree: 'another', ids: ['source']});
    if (kind === 'large') app.event.dataTransfer.getData = () => ' '.repeat(1_000_001);
    if (kind === 'target') app.target.kind = 'generated';
    await app.listeners.get('drop')(app.event);
    assert.equal(app.errors.length, 1, kind);
    assert.deepEqual(app.calls, [], kind);
    app.drop.dispose();
  }
});

test('OS files retain their byte-reading handles while empty directory drops produce an explicit error', async () => {
  const app = dragFixture();
  const file = {name: 'asset.bin', size: 3, arrayBuffer: async () => Uint8Array.of(0, 255, 3).buffer};
  app.event.dataTransfer = {types: ['Files'], files: [file]};
  await app.listeners.get('drop')(app.event);
  assert.deepEqual(app.calls, [['import-drop', app.target, [], {files: [file]}]]);
  app.event.dataTransfer.files = [];
  await app.listeners.get('drop')(app.event);
  assert.match(app.errors[0], /Directory drops are unsupported/);
  assert.equal(app.calls.length, 1);
  app.drop.dispose();
});
