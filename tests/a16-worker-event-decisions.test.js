import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgram} from './a19-runtime-programs.js';
import {connectRuntimeWorker} from './a19-runtime-worker-client.js';

// The actual browser worker entrypoint runs in Node; only postMessage/worker transport is adapted.
const source = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class Program {
  static Windows.Foundation.Deferral held;
  static void Main() {
    ContentDialog dialog = new ContentDialog { Name = "dialog" };
    dialog.PrimaryButtonClick += (sender, value) => {
      ContentDialogPrimaryButtonClickEventArgs args = (ContentDialogPrimaryButtonClickEventArgs)value;
      held = args.GetDeferral(); args.Cancel = true; Console.WriteLine("held");
    };
    Button release = new Button { Name = "release" };
    release.Click += (sender, value) => { Console.WriteLine("released"); held.Complete(); };
    StackPanel panel = new StackPanel(); panel.Children.Add(dialog); panel.Children.Add(release);
    new Window { Content = panel }.Activate();
  }
}`;
let compiled;
const program = () => compiled ??= compileProgram(source);
const engines = {source: built => ({image: built.image}), reload: built => ({assembly: built.assembly}),
  CIL: built => ({assembly: built.assembly, managedIL: true})};

for (const [engine, executable] of Object.entries(engines)) {
  test(engine + ': the actual worker accepts interleaved RPCs while a managed event holds a real deferral', async context => {
    const worker = connectRuntimeWorker(context);
    await worker.ready();
    const launch = await worker.request('launch', {...executable(program()), debug: false, manualAnimations: true});
    const initial = await worker.wait(event => event.event === 'state' && event.sessionId === launch.sessionId
      && ['terminated', 'faulted'].includes(event.state));
    assert.equal(initial.state, 'terminated', JSON.stringify(initial.fault));
    assert.equal(initial.uiActive, true);
    const scene = await worker.request('uiScene', {sessionId: launch.sessionId});
    const dialog = scene.nodes.find(node => node.properties.Name === 'dialog');
    const release = scene.nodes.find(node => node.properties.Name === 'release');
    assert.ok(dialog && release);
    let settled = false;
    const decision = worker.request('uiEventRequest', {version: 1, sessionId: launch.sessionId, requestId: 1,
      id: dialog.id, event: 'PrimaryButtonClick', payload: {Cancel: false}});
    decision.then(() => { settled = true; }, () => { settled = true; });
    await worker.wait(event => event.event === 'output' && event.sessionId === launch.sessionId && event.text.includes('held\n'));
    const during = await worker.request('state', {sessionId: launch.sessionId});
    assert.equal(during.output, 'held\n');
    assert.equal(settled, false, 'The RPC acknowledgement waits for Deferral.Complete');
    await worker.request('uiEvent', {sessionId: launch.sessionId, id: release.id, event: 'Click', payload: {}});
    const result = await decision;
    assert.equal(result.Cancel, true);
    assert.equal(Object.hasOwn(result, 'GetDeferral'), false, 'No native function crosses the worker boundary');
    assert.equal((await worker.request('state', {sessionId: launch.sessionId})).output, 'held\nreleased\n');
    await assert.rejects(worker.request('uiEventRequest', {version: 1, sessionId: launch.sessionId, requestId: 1,
      id: dialog.id, event: 'PrimaryButtonClick', payload: {Cancel: false}}), /already used/);
    await worker.request('stop', {sessionId: launch.sessionId});
  });
}
