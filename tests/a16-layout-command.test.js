import test from 'node:test';
import assert from 'node:assert/strict';
import { HostLayoutCommands } from '../packages/winui-controls/src/host/layout-commands.js';
import { createCanvasMeasureProvider } from '../packages/winui-controls/src/layout/index.js';

test('layout commands are bounded data, execute in order, and skip removed targets', () => {
  const calls = [];
  const host = { nodes: new Map([['one', {}]]), invalidate: (...args) => calls.push(['invalidate', ...args]),
    layoutOperations: { invoke: (...args) => calls.push(args) } };
  const queue = new HostLayoutCommands(host);
  queue.enqueue({ id: 'one', method: 'Measure', args: [{ Width: Infinity, Height: 100 }] });
  queue.enqueue({ id: 'gone', method: 'Arrange', args: [{ X: 0, Y: 0, Width: 5, Height: 5 }] });
  assert.throws(() => queue.enqueue({ id: 'one', method: 'Arrange', args: [{ Width: Infinity }] }), /argument/);
  assert.throws(() => queue.enqueue({ id: 'one', method: 'eval', args: [] }), /command/);
  queue.apply();
  assert.deepEqual(calls, [['one', 'Measure', [{ Width: Infinity, Height: 100 }]]]);
  queue.apply();
  assert.equal(calls.length, 1);
});

test('canvas measure provider consumes real metrics supplied by the host without requiring a document', () => {
  const calls = [];
  const canvas = { getContext: () => ({ font: '', measureText(text) { calls.push([text, this.font]); return { width: 47 }; } }) };
  const provider = createCanvasMeasureProvider(canvas);
  const actual = provider.measure({ type: 'TextBlock', properties: { Text: 'measured', FontSize: 16, TextWrapping: 0 } },
    { width: 100, height: 100 });
  assert.equal(actual.width, 47);
  assert.equal(calls.length, 1);
  assert(calls[0][1].includes('16px'));
  provider.dispose();
});
