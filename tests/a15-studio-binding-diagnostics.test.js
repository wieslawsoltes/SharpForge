import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeBindingDiagnostics, copyBindingDiagnostic, validateBindingDiagnosticBatch} from '../apps/studio/workers/binding-diagnostics.js';
import {RuntimeUIBridge} from '../apps/studio/workers/ui-bridge.js';
import {bindingOutputId} from '../apps/studio/workbench/binding-output.js';
import {compileProgram} from './a19-runtime-programs.js';
import {studioRuntimeSession} from './helpers/studio-runtime-session.js';

const record = (code = 'SFB003', path = 'Missing') => ({code, severity: 'warning', path, step: 0,
  sourceType: 'Source', targetProperty: 'Text', message: 'never-log-this', valuesRedacted: true});

test('Studio binding output copies all ten stable failure codes and bounds, coalesces and disposes pending records', () => {
  const buffer = new RuntimeBindingDiagnostics({maximum: 2}), packets = [];
  for (let code = 1; code <= 10; code++) {
    const value = copyBindingDiagnostic({...record('SFB' + String(code).padStart(3, '0')), sourceValue: 'never-log-this'});
    assert.equal(value.code, 'SFB' + String(code).padStart(3, '0'));
    assert.equal(value.valuesRedacted, true);
    assert.equal(JSON.stringify(value).includes('never-log-this'), false);
  }
  buffer.report(record()); buffer.report(record());
  buffer.report(record('SFB006', 'Password')); buffer.report(record('SFB004', 'Items[999]'));
  buffer.flush(packet => packets.push(packet), 7);
  const batch = validateBindingDiagnosticBatch(packets[0]);
  assert.deepEqual(batch.records.map(value => value.occurrences), [2, 1]);
  assert.deepEqual(batch.records.map(value => value.diagnosticId), [1, 2]);
  assert.equal(batch.omitted, 1);
  assert.match(batch.records[1].message, /redacted/);
  const bounded = copyBindingDiagnostic(record('SFB001', 'x'.repeat(5000)));
  assert.equal(bounded.path.length, 4096);
  assert.equal(bounded.truncated, true);
  assert.equal(buffer.report({...record(), valuesRedacted: false}), false);
  assert.throws(() => validateBindingDiagnosticBatch({...packets[0], records: [batch.records[0], batch.records[0]]}), /sequence/);
  assert.throws(() => validateBindingDiagnosticBatch({...packets[0], records: Array(129).fill(batch.records[0])}), /batch/);
  buffer.dispose(); buffer.report(record()); buffer.flush(packet => packets.push(packet), 7);
  assert.equal(packets.length, 1);
});

test('Runtime UI diagnostics preserve explicit observers while a throwing observer cannot escape into a binding', () => {
  const packets = [], received = [];
  const bridge = new RuntimeUIBridge({post: packet => packets.push(packet), wake() {}});
  const options = bridge.runtimeOptions({uiServices: {marker: 42, bindingDiagnostics: diagnostic => {
    received.push(diagnostic); throw new Error('observer failure');
  }}});
  assert.equal(options.uiServices.marker, 42);
  assert.doesNotThrow(() => options.uiServices.bindingDiagnostics(record()));
  assert.equal(packets.length, 0, 'An uncommitted launch candidate cannot publish diagnostic output');
  bridge.attach({state: 'ready'}, 1); bridge.flush();
  assert.equal(received.length, 1);
  assert.equal(packets[0].event, 'bindingDiagnostics');
  bridge.dispose(); options.uiServices.bindingDiagnostics(record());
  assert.equal(packets.length, 1);
});

const source = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Data;
class BindingSource : Control { public string Token { get { return "never-log-this"; } } }
class Program { static void Main() {
  BindingSource source = new BindingSource(); TextBlock target = new TextBlock { Name = "target" };
  target.SetBinding(TextBlock.TextProperty, new Binding { Source = source, Path = new PropertyPath("MissingTitle"), FallbackValue = "fallback" });
  target.SetBinding(FrameworkElement.WidthProperty, new Binding { Source = source, Path = new PropertyPath("Token"), FallbackValue = 40.0 });
  new Window { Content = target }.Activate(); Console.WriteLine("application-continues");
} }`;
let compiled;
const program = () => compiled ??= compileProgram(source);
const engines = {source: built => ({image: built.image, bindingAssembly: built.assembly}),
  reload: built => ({assembly: built.assembly}), CIL: built => ({assembly: built.assembly, managedIL: true})};

for (const [engine, executable] of Object.entries(engines)) {
  test(engine + ': real worker binding failures reach the owning Studio output channel with redacted identities', async context => {
    const fixture = studioRuntimeSession(context);
    await fixture.session.launch({...executable(program()), debug: false, manualAnimations: true});
    const serial = fixture.session.runtimeSession;
    const state = await fixture.wait(value => value.event === 'state' && value.sessionId === serial
      && ['terminated', 'faulted'].includes(value.state));
    assert.equal(state.state, 'terminated', JSON.stringify(state.fault));
    const missing = await fixture.wait(value => value.event === 'bindingDiagnostics' && value.sessionId === serial
      && value.records.some(item => item.code === 'SFB003'));
    await fixture.wait(value => value.event === 'bindingDiagnostics' && value.sessionId === serial
      && value.records.some(item => item.code === 'SFB006'));
    const rows = fixture.output.read(bindingOutputId(fixture.session));
    const diagnostics = rows.map(row => row.diagnostic).filter(Boolean);
    assert.ok(diagnostics.some(value => value.code === 'SFB003' && value.path === 'MissingTitle' && value.targetProperty === 'Text'));
    assert.ok(diagnostics.some(value => value.code === 'SFB006' && value.path === 'Token' && value.targetProperty === 'Width'));
    assert.ok(diagnostics.every(value => value.sourceType === 'BindingSource' && value.valuesRedacted));
    assert.ok(rows.every(row => row.identity === fixture.session.identity && row.runtimeSession === serial && row.source === 'binding'));
    assert.equal(fixture.output.text(bindingOutputId(fixture.session)).includes('never-log-this'), false);
    assert.equal(fixture.session.programOutput, 'application-continues\n');
    const generation = fixture.session.worker.generation, count = rows.length;
    assert.equal(fixture.session.receive(missing, generation - 1), false);
    assert.equal(fixture.session.receive({...missing, sessionId: serial + 1}, generation), false);
    assert.equal(fixture.output.read(bindingOutputId(fixture.session)).length, count);
    assert.deepEqual(fixture.errors, []);
    await fixture.session.stop();
    fixture.session.dispose();
    assert.equal(fixture.output.get(bindingOutputId(fixture.session)), null, 'Removing an application releases its diagnostic channel');
  });
}
