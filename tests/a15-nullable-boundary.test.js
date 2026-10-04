import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, intrinsicDefinition, nullableElementType, verifyCilAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {nullableValue, requireNullable, projectNullableArguments, invokeNullable} from '../packages/runtime/src/execution/nullable.js';
import {storageDefault, storageValue} from '../packages/runtime/src/execution/storage.js';

test('A15 closed nullable ABI accepts exact constructor signatures and preserves present zero', () => {
  const owner = 'System.Nullable`1<double>';
  const descriptor = {kind: 'method', owner, name: '.ctor', signature: {isStatic: false, parameters: ['double'], returnType: 'void'}};
  assert.equal(intrinsicDefinition(descriptor)?.implementation, 'nullableCtor');
  assert.equal(intrinsicDefinition({...descriptor, signature: {...descriptor.signature, parameters: ['!0']}})?.implementation, 'nullableCtor');
  assert.equal(intrinsicDefinition({...descriptor, signature: {...descriptor.signature, parameters: ['int']}}), null);
  assert.equal(nullableElementType('System.Nullable`1<System.Single>'), 'float');
  assert.equal(nullableElementType('System.Nullable`1<object>'), null);
  const absent = storageDefault({}, owner);
  const zero = nullableValue({}, owner, true, 0);
  assert.equal(absent.hasValue, false);
  assert.equal(zero.hasValue, true);
  assert.equal(storageValue({}, zero, 'double?'), zero);
  assert.throws(() => requireNullable({}, zero, 'float?'), /type mismatch/);
  const contract = {parameters: ['double?', 'double?', 'float?'], isStatic: true};
  const args = projectNullableArguments({}, contract, [absent, zero, nullableValue({}, 'float?', true, 1)]);
  assert.equal(args[0], null);
  assert.equal(args[1].value, 0);
  assert.equal(args[2].float, 'r4');
  assert.throws(() => invokeNullable({}, {...descriptor, name: 'get_Value'}, absent, []), /must have a value/);
});

test('A15 dynamic XAML assemblies anchor real UI and converter members in the UI shim', () => {
  const built = compileToIL('using Microsoft.UI.Xaml.Markup; XamlReader.Load("<Grid />");', {includeDebug: false});
  assert.equal(built.success, true, built.diagnostics.map(d => d.message).join('\n'));
  const inspector = new AssemblyInspector(built.assembly);
  const members = (inspector.metadata.rows[10] ?? []).map((_, index) => inspector.resolveToken(0x0a000001 + index));
  assert.ok(members.some(member => member.owner === 'Microsoft.UI.Xaml.Controls.TextBlock' && member.name === 'set_Text'));
  assert.ok(members.some(member => member.owner === 'Microsoft.UI.Xaml.Data.IValueConverter' && member.name === 'ConvertBack'));
  const types = inspector.metadata.rows[1] ?? [];
  const row = types.find(row => inspector.metadata.string(row[1]) === 'Size' && inspector.metadata.string(row[2]) === 'Windows.Foundation');
  assert.ok(row);
  const assembly = inspector.metadata.rows[35][(row[0] >> 2) - 1];
  assert.equal(inspector.metadata.string(assembly[6]), 'SharpForge.WinUI');
});

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: ChangeView emits real Nullable<T> and preserves an unchanged axis`, async () => {
    const source = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
      ScrollViewer viewer = new ScrollViewer {Width = 100, Height = 100,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto};
      viewer.Content = new Border { Width = 1000, Height = 1000 };
      Window window = new Window { Content = viewer }; window.Activate();
      viewer.Measure(new Windows.Foundation.Size(100, 100));
      viewer.Arrange(new Windows.Foundation.Rect(0, 0, 100, 100));
      viewer.ChangeView(20.0, 30.0, 2.0f, true);
      viewer.ChangeView(null, 0.0, null, true);
      Console.WriteLine(viewer.HorizontalOffset); Console.WriteLine(viewer.VerticalOffset); Console.WriteLine(viewer.ZoomFactor);`;
    const built = compileToIL(source, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(d => d.message).join('\n'));
    assert.equal(verifyCilAssembly(built.assembly).success, true);
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly, {virtualTime: true});
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '20\n0\n2\n');
  });
}
