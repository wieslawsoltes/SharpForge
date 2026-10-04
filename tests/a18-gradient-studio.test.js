import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesignerBrush} from '@sharpforge/designer';
import {studioHarness, sourceState, ownerUri, constructionUri} from './fixtures/a18-studio-harness.js';
import {gradientBrush, gradientVisual, runGradient} from './fixtures/a18-gradients.js';
import {DesignerStatePlayback} from '../apps/studio/designer-resource-playback.js';

async function verifyWorkerBuild(harness, brush) {
  const compilation = await harness.build();
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  runGradient(compilation, machine => {
    const actual = gradientVisual(machine).properties.Background;
    if (brush === undefined) assert.equal(actual, undefined);
    else assert.deepEqual(normalizeDesignerBrush(actual), brush);
  });
}

test('A18 production worker applies gradients to a partial construction file and restores exact source and values on undo/redo',
  async context => {
    const harness = await studioHarness(context, {subscription: ''});
    await harness.connect();
    const before = sourceState(harness);
    const brush = gradientBrush();
    harness.document.setProperty('Background', brush, ['action']);
    const result = await harness.sync.write();
    assert.equal(result.state, 'synced');
    assert.equal(harness.sync.session.analysis.compilationSucceeded, true);
    assert.equal(harness.history.past.length, 1);
    assert.equal(harness.history.past[0].uri, ownerUri);
    assert.deepEqual(harness.history.past[0].changes.map(change => change.uri), [constructionUri]);
    assert.equal(harness.file(ownerUri).text, before.files.find(file => file.uri === ownerUri).text);
    assert.equal(harness.file(constructionUri).version, 2);
    assert.match(harness.file(constructionUri).text, /GradientStops = new Microsoft\.UI\.Xaml\.Media\.GradientStopCollection/);
    assert.deepEqual(harness.document.node('action').properties.Background, brush);
    const written = harness.file(constructionUri).text;
    await verifyWorkerBuild(harness, brush);
    assert.equal(harness.history.undo(ownerUri), true);
    assert.deepEqual(harness.state.files.map(file => file.text), before.files.map(file => file.text));
    assert.equal(harness.document.node('action').properties.Background, undefined);
    assert.equal(harness.sync.dirty(), false);
    await verifyWorkerBuild(harness, undefined);
    assert.equal(harness.history.undo(constructionUri, true), true);
    assert.equal(harness.file(constructionUri).text, written);
    assert.deepEqual(harness.document.node('action').properties.Background, brush);
    await verifyWorkerBuild(harness, brush);
    assert(harness.compiler.requests.some(request => request.method === 'designAnalyze' && request.operation === 'plan'));
    assert.deepEqual(harness.previews.at(-1).nodes.find(node => node.id === 'action').properties.Background, brush);
  });

test('A18 worker-qualified gradient edits reject changed dependencies and keep the complete staged brush', async context => {
  const harness = await studioHarness(context, {subscription: ''});
  await harness.connect();
  const brush = gradientBrush();
  harness.document.setProperty('Background', brush, ['action']);
  let external;
  let candidate;
  harness.compiler.afterResponse = (method, params, result) => {
    if (method !== 'designAnalyze' || params.operation !== 'plan') return;
    harness.compiler.afterResponse = null;
    candidate = result;
    harness.type(ownerUri, harness.file(ownerUri).text + '\n// Ordinary concurrent source edit', {notifyChange: false});
    external = sourceState(harness);
  };
  await assert.rejects(harness.sync.write(), /Workspace changed|dependency changed|changed during compilation/i);
  assert.equal(candidate.success, true);
  assert.deepEqual(sourceState(harness), external);
  assert.equal(harness.history.past.length, 0);
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.sync.state, 'blocked');
  assert.equal(harness.sync.dirty(), true);
  assert.deepEqual(harness.document.node('action').properties.Background, brush);
});

test('A18 gradient state preview forwards typed brushes to the renderer without overriding them with approximate CSS', () => {
  const callbacks = new Map();
  let identifier = 0;
  const commands = [];
  const scenes = [];
  const document = {revision: 3};
  const host = {
    disposed: false,
    document: {defaultView: {
      requestAnimationFrame(callback) { callbacks.set(++identifier, callback); return identifier; },
      cancelAnimationFrame(id) { callbacks.delete(id); }
    }},
    get elements() { throw new Error('State playback must leave paint geometry to the typed renderer'); },
    load(scene) { scenes.push(structuredClone(scene)); },
    apply(value) { commands.push(structuredClone(value)); },
    flush() {}
  };
  const view = {document, host, drawAdorners() {}, error(error) { throw error; }};
  const before = {version: 1, windows: ['root'], nodes: [{id: 'root', type: 'Microsoft.UI.Xaml.Controls.Button',
    properties: {Background: gradientBrush()}, collections: {}}]};
  const after = structuredClone(before);
  after.nodes[0].properties.Background = gradientBrush({StartPoint: {X: -1, Y: 0.4}});
  const playback = new DesignerStatePlayback(view);
  playback.play(before, before, after, {duration: 10});
  const frame = timestamp => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(timestamp);
  };
  frame(100);
  frame(110);
  assert.deepEqual(commands.at(-1)[0].value, after.nodes[0].properties.Background);
  assert.equal(playback.session, null);
  assert.deepEqual(scenes[0], before);
  playback.stop();
  assert.deepEqual(scenes.at(-1), before);
  playback.dispose();
  assert.equal(callbacks.size, 0);
});
