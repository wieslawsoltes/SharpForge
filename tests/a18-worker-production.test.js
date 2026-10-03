import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {DesignerWorkerChannel} from '../apps/studio/designer-worker-channel.js';

class NodeWorkerPort extends EventTarget {
  constructor(worker) {
    super();
    this.worker = worker;
    this.terminated = false;
    worker.on('message', data => this.dispatchEvent(new MessageEvent('message', {data})));
    worker.on('error', error => {
      const event = new Event('error');
      Object.defineProperty(event, 'message', {value: error.message});
      this.dispatchEvent(event);
    });
  }
  postMessage(message) { this.worker.postMessage(message); }
  terminate() { this.terminated = true; this.closed ??= this.worker.terminate(); }
}

test('production compiler awaits designer requests, preserves active builds and survives canceled waits', {timeout: 20000}, async context => {
  const worker = new Worker(new URL('./fixtures/a18-studio-worker.mjs', import.meta.url));
  let channel, port;
  context.after(async () => {
    channel?.dispose();
    await (port?.closed ?? worker.terminate());
  });
  assert.deepEqual((await once(worker, 'message'))[0], {ready: true});
  port = new NodeWorkerPort(worker);
  channel = new DesignerWorkerChannel(port, {timeout: 15000});
  const active = await channel.request('build', {revision: 1, compilationOptions: {outputKind: 'library'},
    files: [{uri: 'Active.cs', version: 1, text: 'public class Active { public static int Value() { return 42; } }'}]});
  assert.equal(active.success, true);
  assert.ok(active.assembly.byteLength > 0, 'the production compiler emitted an actual CIL assembly');
  const params = {operation: 'analyze', uri: 'View.cs', revision: 2, generation: 1, requestOwner: 'transport-test',
    compilationOptions: {outputKind: 'library'}, files: [{uri: 'View.cs', version: 1, text: `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class View {
    public static Window Create() {
        var window = new Window();
        var panel = new Canvas();
        var action = new Button { Name = "Action", Content = "Run", Width = 120 };
        panel.Children.Add(action);
        window.Content = panel;
        return window;
    }
}`} ]};
  const candidate = await channel.request('designAnalyze', params);
  assert.equal(candidate.success, true, JSON.stringify(candidate.diagnostics));
  assert.ok(candidate.analysis.document.nodes.some(node => node.properties.Name === 'Action'));
  const controller = new AbortController();
  const canceled = channel.request('designAnalyze', {...params, generation: 2}, {signal: controller.signal});
  const expected = assert.rejects(canceled, {name: 'AbortError'});
  controller.abort();
  await expected;
  assert.equal(port.terminated, false, 'caller cancellation does not terminate the shared compiler');
  const rebuilt = await channel.request('build');
  assert.equal(rebuilt.success, true);
  assert.deepEqual(rebuilt.image, active.image, 'designer candidates did not replace the active program');
  assert.deepEqual(rebuilt.assembly, active.assembly);
  assert.equal(rebuilt.metrics.assemblyCached, true);
  assert.equal(channel.pending.size, 0);
});
