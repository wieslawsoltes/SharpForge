import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {RefKind} from '../packages/compiler/src/symbols/types.js';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls; using Windows.Foundation;\n';
const build = source => {
  const result = compileToIL(prefix + source, {includeDebug: false});
  assert.equal(result.success, true, result.diagnostics.map(d => d.code + ': ' + d.message).join('\n'));
  return result;
};
const run = async (built, Engine) => {
  const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly, {virtualTime: true, initialThreshold: 64});
  const result = await vm.runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack ?? result.fault?.message);
  return {vm, result};
};

test('A15 compiler preserves UI ancestry, inherited offsets and virtual metadata', () => {
  const built = build(`class Derived : BaseControl {
    public int Child = 7;
    public override int Read() { return base.Read() + Child; }
  }
  class BaseControl : Control { public int Parent = 5; public virtual int Read() { return Parent; } }
  class P { static void Main() { BaseControl value = new Derived(); Console.WriteLine(value.Read()); } }`);
  const base = built.image.types.find(type => type.name === 'BaseControl');
  const derived = built.image.types.find(type => type.name === 'Derived');
  assert.equal(base.base, 'Microsoft.UI.Xaml.Controls.Control');
  assert.equal(derived.base, 'BaseControl');
  assert.equal(derived.uiFrameworkBase, 'Microsoft.UI.Xaml.Controls.Control');
  assert.deepEqual(base.fields.map(field => [field.name, field.index]), [['Parent', 0]]);
  assert.deepEqual(derived.fields.map(field => [field.name, field.index]), [['Child', 1]]);
  const override = built.image.methods.find(method => method.owner === 'Derived' && method.name === 'Read');
  assert.equal(override.virtualSlot, 'Read()');
  assert.equal(override.isOverride, true);
  const inspector = new AssemblyInspector(built.assembly);
  const type = inspector.types.find(type => type.name === 'Derived');
  assert.equal(inspector.metadata.typeName(type.baseToken), 'BaseControl');
  const method = type.methods.find(method => method.name === 'Read');
  assert.equal(method.flags & 0x40, 0x40);
  assert.equal(method.flags & 0x100, 0);
});

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: UI virtual/base calls, property slots and checked casts`, async () => {
    const built = build(`class BaseControl : Control {
      public int Parent = 5; public virtual int Read() { return Parent; }
      public virtual int Number { get { return Parent; } set { Parent = value; } }
    }
    class Derived : BaseControl {
      public int Child = 7; public override int Read() { return base.Read() + Child; }
      public override int Number { get { return base.Number + Child; } set { base.Number = value - Child; } }
    }
    class P { static void Main() {
      BaseControl value = new Derived(); Console.WriteLine(value.Read()); value.Number = 20;
      Console.WriteLine(value.Number); object boxed = value; Console.WriteLine(boxed is Derived);
      Derived cast = boxed as Derived; Console.WriteLine(cast.Child); Console.WriteLine(((Derived)boxed).Parent);
      object wrong = new Button(); Console.WriteLine(wrong as Derived == null);
    } }`);
    assert.equal((await run(built, Engine)).result.output, '12\n20\nTrue\n7\n13\nTrue\n');
  });

  test(`A15 ${Engine.name}: custom dependency-property owner and typed unboxing`, async () => {
    const built = build(`class Meter : Control {
      public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        "Value", typeof(double), typeof(Meter), new PropertyMetadata(4.0));
      public double Value { get { return (double)GetValue(ValueProperty); } set { SetValue(ValueProperty, value); } }
    }
    class P { static void Main() { Meter meter = new Meter(); Console.WriteLine(meter.Value);
      meter.Value = 17.5; Console.WriteLine(meter.Value); Console.WriteLine(typeof(Meter).Name); } }`);
    assert.equal((await run(built, Engine)).result.output, '4\n17.5\nMeter\n');
  });

  test(`A15 ${Engine.name}: OnApplyTemplate sees fresh named parts exactly once per application`, async () => {
    const built = build(`class Custom : Control {
      public int Applied; public bool Found;
      protected override void OnApplyTemplate() { base.OnApplyTemplate(); Applied++; Found = GetTemplateChild("part") != null; }
    }
    class P { static void Main() {
      Custom control = new Custom(); ControlTemplate template = new ControlTemplate();
      template.VisualTree = new Border { Name = "part" }; control.Template = template;
      Console.WriteLine(control.ApplyTemplate()); Console.WriteLine(control.Applied); Console.WriteLine(control.Found);
      Console.WriteLine(control.ApplyTemplate()); Console.WriteLine(control.Applied);
    } }`);
    assert.equal((await run(built, Engine)).result.output, 'True\n1\nTrue\nFalse\n1\n');
  });

  test(`A15 ${Engine.name}: framework out arguments share real variable storage`, async () => {
    const built = build(`ResourceDictionary dictionary = new ResourceDictionary(); dictionary.Add("answer", "forty-two");
      Console.WriteLine(dictionary.TryGetValue("answer", out object result)); Console.WriteLine(result);
      Console.WriteLine(dictionary.TryGetValue("absent", out result)); Console.WriteLine(result == null);`);
    assert.equal((await run(built, Engine)).result.output, 'True\nforty-two\nFalse\nTrue\n');
    const inspector = new AssemblyInspector(built.assembly);
    assert.ok([...inspector.methods.keys()].some(token => inspector.getMethod(token).instructions.some(instruction => instruction.name === 'ldflda')));
  });

  test(`A15 ${Engine.name}: typed UI event delegates remain callable after Main and collection`, async () => {
    const built = build(`class Counter : Button { public int Calls; public void Hit(object sender, RoutedEventArgs args) { Calls++; Content = Calls; } }
      class P { static void Main() { Counter counter = new Counter { Name = "counter" };
        counter.Click += counter.Hit; Window window = new Window { Content = counter }; window.Activate(); } }`);
    const {vm} = await run(built, Engine);
    vm.heap.collect();
    const counter = vm.platform.scene().nodes.find(node => node.properties.Name === 'counter');
    vm.platform.dispatchEvent(counter.id, 'Click');
    await vm.runAsync();
    assert.equal(vm.platform.scene().nodes.find(node => node.id === counter.id).properties.Content, 1);
    const type = built.image.types.find(type => type.delegateContract === 'Microsoft.UI.Xaml.RoutedEventHandler');
    assert.match(type.name, /^SharpForge\.<>Delegate\{/);
    assert.equal(built.image.methods[type.delegateInvoke].name, 'Invoke');
  });
}

test('A15 registry bridge exposes true out parameter symbols and nullable value types', () => {
  const bridge = new RegistryBridge();
  const method = bridge.typeFromName('Microsoft.UI.Xaml.ResourceDictionary').getMembers('TryGetValue')[0];
  assert.equal(method.parameters[1].refKind, RefKind.Out);
  assert.equal(method.parameters[1].type.specialType, 'System_Object');
  assert.equal(bridge.typeFromName('double?').nullableUnderlyingType.specialType, 'System_Double');
});

test('A15 profile still rejects unrelated inheritance and unsupported byref locations', () => {
  const inherited = compile('class A {} class B : A {} class P { static void Main() { B b = new B(); } }');
  assert.equal(inherited.success, false);
  assert.ok(inherited.diagnostics.some(d => d.code === 'SF2200' && /inheritance/.test(d.message)));
  const field = compile(prefix + 'class P { static object value; static void Main() {' +
    'ResourceDictionary d = new ResourceDictionary(); d.TryGetValue("x", out value); } }');
  assert.equal(field.success, false);
  assert.ok(field.diagnostics.some(d => d.code === 'SF2200' && /by reference/.test(d.message)));
});
