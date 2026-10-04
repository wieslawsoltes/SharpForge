import test from 'node:test';
import assert from 'node:assert/strict';
import {CancellationToken} from '@sharpforge/syntax';
import {
  readDesignSource, designSourceDiagnostic, createDesignerResourceDocument,
  generateDesignerResourceClass, analyzeDesignerResourceSources
} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml.Controls;
class View { static Grid Create() { var root = new Grid { Width = 120 }; return root; } }`;

test('source analysis accepts a live AbortSignal and an existing syntax cancellation token', () => {
  const controller = new AbortController();
  assert.equal(readDesignSource(source, {signal: controller.signal}).compilationSucceeded, true);
  let polls = 0;
  const token = new CancellationToken({poll: () => { polls++; return false; }});
  assert.equal(readDesignSource(source, {signal: token}).compilationSucceeded, true);
  assert.ok(polls > 0);
  controller.abort();
  assert.throws(() => readDesignSource(source, {signal: controller.signal}), {code: 'SFSYNC_CANCELLED'});
});

test('cancellation raised during parser polling propagates and maps to the stable cancellation diagnostic', () => {
  let polls = 0;
  const token = new CancellationToken({poll: () => ++polls >= 3});
  const longSource = source.replace('return root;', ';'.repeat(1024) + 'return root;');
  let cancelled;
  try { readDesignSource(longSource, {signal: token}); }
  catch (error) { cancelled = error; }
  assert.equal(cancelled?.code, 'OperationCanceled');
  assert.equal(designSourceDiagnostic(cancelled).code, 'SFD0009');
  assert.ok(polls >= 3);
});

test('guarded resource parsing uses the same AbortSignal adapter without claiming native compilation success', () => {
  const document = createDesignerResourceDocument({name: 'Resources', resources: {Count: {type: 'int', value: 1}}});
  const text = generateDesignerResourceClass(document.value);
  document.dispose();
  const controller = new AbortController();
  const result = analyzeDesignerResourceSources([{uri: 'Resources.cs', text}], {uri: 'Resources.cs', signal: controller.signal});
  assert.equal(result.previewReady, true);
  assert.equal(result.compilationSucceeded, false);
  assert.equal(result.document.resources.Count.value, 1);
  const native = new CancellationToken();
  native.cancel();
  assert.throws(() => analyzeDesignerResourceSources([{uri: 'Resources.cs', text}], {signal: native}), {code: 'OperationCanceled'});
  controller.abort();
  assert.throws(() => analyzeDesignerResourceSources([{uri: 'Resources.cs', text}], {signal: controller.signal}),
    error => error.name === 'AbortError');
});
