import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignerResourceDocument, generateDesignerResourceClass} from '@sharpforge/designer';
import {DesignerResourceSourceAdapter} from '../apps/studio/designer-resource-source.js';
import {registerDesignerResourceSourceWorker} from '../apps/studio/designer-resource-source-worker.js';

const uri = 'Resources.cs';

function text(value = 1) {
  const document = createDesignerResourceDocument({name: 'Resources', resources: {Count: {type: 'int', value}}});
  try { return generateDesignerResourceClass(document.value); }
  finally { document.dispose(); }
}

/** In-process transport only; every handler runs the actual public semantic compiler and resource decoder. */
function host({request} = {}) {
  const handlers = new Map();
  const unregister = registerDesignerResourceSourceWorker({registerHandler(name, handler) {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }});
  const invoke = (name, params) => Promise.resolve().then(() => structuredClone(handlers.get(name)(structuredClone(params))));
  const document = createDesignerResourceDocument();
  const files = [{uri, text: text(), version: 0}];
  const diagnostics = [];
  const navigation = [];
  const adapter = new DesignerResourceSourceAdapter({uri, document, readSources: () => files,
    request: request ? (name, params) => request(invoke, name, params) : invoke,
    publishDiagnostics: (source, values) => diagnostics.push({source, values}),
    openSource: (...args) => navigation.push(args)});
  return {adapter, document, files, diagnostics, navigation, invoke,
    dispose() { adapter.dispose(); document.dispose(); unregister(); }};
}

test('resource adapter loads a same-URI preview, stages rename, exports a guarded candidate and refuses unsupported writes', async () => {
  const scope = host();
  try {
    await scope.adapter.connect();
    assert.equal(scope.adapter.snapshot().previewReady, true);
    assert.equal(scope.adapter.snapshot().canApply, false);
    assert.equal(scope.document.value.resources.Count.value, 1);
    const sourceBefore = scope.files[0].text;
    scope.adapter.rename('Count', 'Total');
    assert.equal(scope.adapter.snapshot().state, 'design-dirty');
    assert.equal(scope.document.undoStack.length, 1);
    const plan = await scope.adapter.plan();
    assert.equal(plan.analysis.document.resources.Total.value, 1);
    assert.equal(plan.canApply, false);
    assert.notEqual(plan.text, sourceBefore);
    await assert.rejects(scope.adapter.write(), {code: 'SFD1884'});
    assert.equal(scope.files[0].text, sourceBefore);
    assert.equal(scope.document.value.resources.Total.value, 1);
    scope.adapter.navigate();
    assert.equal(scope.navigation[0][0], uri);
    assert.ok(scope.navigation[0][1] > 0);
    scope.document.undo();
    assert.equal((await scope.adapter.write()).noOp, true);
  } finally { scope.dispose(); }
});

test('malformed source retains the last valid resource preview and recovery replaces it only after successful analysis', async () => {
  const scope = host();
  try {
    await scope.adapter.connect();
    const previous = scope.document.serialize();
    scope.files[0].text += '{';
    scope.files[0].version++;
    await assert.rejects(scope.adapter.analyze(), {code: 'SFD1880'});
    assert.equal(scope.document.serialize(), previous);
    assert.equal(scope.adapter.state, 'blocked');
    scope.files[0].text = text(2);
    scope.files[0].version++;
    await scope.adapter.analyze();
    assert.equal(scope.document.value.resources.Count.value, 2);
    assert.equal(scope.adapter.state, 'preview-only');
  } finally { scope.dispose(); }
});

test('external source changes during staged edits preserve both versions and require explicit discard', async () => {
  const scope = host();
  try {
    await scope.adapter.connect();
    scope.adapter.rename('Count', 'Total');
    const staged = scope.document.serialize();
    scope.files[0] = {uri, text: text(3), version: 1};
    await assert.rejects(scope.adapter.analyze(), {code: 'SFD1882'});
    assert.equal(scope.adapter.state, 'conflict');
    assert.equal(scope.document.serialize(), staged);
    assert.equal(scope.files[0].text, text(3));
    await scope.adapter.analyze({discard: true});
    assert.equal(scope.document.value.resources.Count.value, 3);
    assert.ok(!scope.document.value.resources.Total);
  } finally { scope.dispose(); }
});

test('superseded analysis cannot replace the newer resource document', async () => {
  const pending = [];
  const scope = host({request: (invoke, name, params) => new Promise(resolve => {
    pending.push(async () => resolve(await invoke(name, params)));
  })});
  try {
    const first = scope.adapter.analyze();
    scope.files[0] = {uri, text: text(4), version: 1};
    const second = scope.adapter.analyze();
    await pending[1]();
    await second;
    await pending[0]();
    assert.equal(await first, null);
    assert.equal(scope.document.value.resources.Count.value, 4);
  } finally { scope.dispose(); }
});

test('closed resource adapter cancels publication of a pending analysis and detaches document listeners', async () => {
  let complete;
  const scope = host({request: (invoke, name, params) => new Promise(resolve => {
    complete = async () => resolve(await invoke(name, params));
  })});
  const before = scope.document.serialize();
  const reading = scope.adapter.analyze();
  scope.adapter.dispose();
  await complete();
  assert.equal(await reading, null);
  assert.equal(scope.document.serialize(), before);
  assert.equal(scope.diagnostics.length, 0);
  await assert.rejects(scope.adapter.analyze(), {code: 'SFD1886'});
  scope.dispose();
});

test('worker contract reports preview readiness separately from compilation and rejects unknown operations', async () => {
  const scope = host();
  try {
    const result = await scope.invoke('designResourceAnalyze', {uri, files: scope.files, generation: 19});
    assert.equal(result.success, true);
    assert.equal(result.analysis.compilationSucceeded, false);
    assert.equal(result.generation, 19);
    const invalid = await scope.invoke('designResourceAnalyze', {operation: 'executeMarkup', uri, files: scope.files});
    assert.equal(invalid.success, false);
    assert.equal(invalid.diagnostics[0].code, 'SFD1880');
    const probe = await scope.invoke('designResourceAnalyze', {operation: 'probe', uri, files: scope.files});
    assert.equal(probe.probe.compatible, true);
  } finally { scope.dispose(); }
});
