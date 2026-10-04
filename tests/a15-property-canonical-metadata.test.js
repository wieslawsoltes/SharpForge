import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {decodeInstructions, emitAssembly, loadAssembly, readPE} from '@sharpforge/cil';
import {propertyEngines} from './helpers/a15-property-managed-fixture.js';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;\n';

function build(source) {
  const built = compileToIL(prefix + source, {embedSources: false});
  assert.equal(built.success, true, built.diagnostics.map(value => value.code + ': ' + value.message).join('\n'));
  return built;
}

function assertOutput(built, expected) {
  for (const [engine, vm] of propertyEngines(built)) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', engine + ': ' + JSON.stringify(result.fault));
    assert.equal(result.output, expected, engine);
  }
}

test('A15 canonical UI metadata retains ancestry, absolute inherited slots and virtual flags without embedded source', () => {
  const built = build(`class Derived : BaseControl {
    public int Child = 7; public override int Read() { return base.Read() + Child; }
  }
  class BaseControl : Control { public int Parent = 5; public virtual int Read() { return Parent; } }
  class P { static void Main() { BaseControl value = new Derived(); Console.WriteLine(value.Read()); } }`);
  const decoded = loadAssembly(built.assembly);
  assert(decoded.sources.every(source => source.text === undefined));
  const base = decoded.types.find(type => type.name === 'BaseControl');
  const derived = decoded.types.find(type => type.name === 'Derived');
  assert.equal(base.base, 'Microsoft.UI.Xaml.Controls.Control');
  assert.equal(derived.base, 'BaseControl');
  assert.equal(derived.uiFrameworkBase, 'Microsoft.UI.Xaml.Controls.Control');
  assert.deepEqual(base.fields.map(field => [field.name, field.index]), [['Parent', 0]]);
  assert.deepEqual(derived.fields.map(field => [field.name, field.index]), [['Child', 1]]);
  const baseRead = decoded.methods.find(method => method.owner === base.name && method.name === 'Read');
  const derivedRead = decoded.methods.find(method => method.owner === derived.name && method.name === 'Read');
  assert.equal(baseRead.isVirtual, true);
  assert.equal(baseRead.isOverride, false);
  assert.equal(derivedRead.isVirtual, true);
  assert.equal(derivedRead.isOverride, true);
  assert.equal(derivedRead.virtualSlot, 'Read()');
  assert.equal(derivedRead.access, 'public');
  assertOutput(built, '12\n');
});

test('A15 canonical indexers retain actual parameter signatures and accessor associations', () => {
  for (const name of ['Item', 'Cell']) {
    const attribute = name === 'Item' ? '' : '[System.Runtime.CompilerServices.IndexerName("Cell")]';
    const built = build(`class Indexed : Control {
      int stored = 2;
      ${attribute} public int this[int index] { get { return stored + index; } set { stored = value - index; } }
    }
    class P { static void Main() { Indexed value = new Indexed(); value[2] = 11; Console.WriteLine(value[3]); } }`);
    const decoded = loadAssembly(built.assembly);
    for (const image of [built.image, decoded]) {
      const type = image.types.find(value => value.name === 'Indexed');
      const property = type.properties.find(value => value.name === name);
      assert(property, name + ': metadata name');
      assert.deepEqual(property.parameters.map(value => value.type), ['int']);
      for (const kind of ['get', 'set']) {
        const method = image.methods[property[kind]];
        assert.equal(method.name, kind + '_' + name);
        assert.equal(method.accessor.kind, kind);
        assert.equal(method.accessor.property, name);
      }
    }
    assertOutput(built, '12\n');
  }
});

test('A15 canonical framework delegate adapters preserve callback identity across removal and collection', async () => {
  const built = build(`class Counter : Button {
    public int Calls; public void Hit(object sender, RoutedEventArgs args) { Calls++; Content = Calls; }
  }
  class P { static void Main() {
    Counter counter = new Counter { Name = "counter" };
    counter.Click += counter.Hit; counter.Click += counter.Hit; counter.Click -= counter.Hit;
    new Window { Content = counter }.Activate();
  } }`);
  const decoded = loadAssembly(built.assembly);
  const delegate = decoded.types.find(type => type.delegateContract === 'Microsoft.UI.Xaml.RoutedEventHandler');
  assert(delegate);
  assert.equal(decoded.methods[delegate.delegateInvoke].name, 'Invoke');
  assert.equal(decoded.methods[delegate.frameworkInvoke].name, '<framework-invoke>');
  for (const [engine, vm] of propertyEngines(built)) {
    assert.equal(vm.run().state, 'terminated', engine);
    vm.heap.collect();
    const counter = vm.platform.scene().nodes.find(node => node.properties.Name === 'counter');
    assert(counter, engine);
    vm.platform.dispatchEvent(counter.id, 'Click');
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', engine + ': ' + JSON.stringify(result.fault));
    assert.equal(vm.platform.scene().nodes.find(node => node.id === counter.id).properties.Content, 1, engine);
  }
});

test('A15 canonical byref adaptation recovers real compiler-owned cell storage', () => {
  const built = build(`ResourceDictionary values = new ResourceDictionary(); values.Add("answer", "forty-two");
    Console.WriteLine(values.TryGetValue("answer", out object result)); Console.WriteLine(result);
    Console.WriteLine(values.TryGetValue("missing", out result)); Console.WriteLine(result == null);`);
  const decoded = loadAssembly(built.assembly);
  const cell = decoded.types.find(type => type.referenceCell);
  assert.equal(cell.name, '<>Cell(object)');
  assert.deepEqual(cell.referenceCell, {valueType: 'object', field: 0});
  assert.deepEqual(cell.fields.map(field => [field.name, field.type]), [['Value', 'object']]);
  assertOutput(built, 'True\nforty-two\nFalse\nTrue\n');
});

test('A15 typed catches preserve the exact approved CLI exception identity and select the matching handler', () => {
  const built = build(`Button button = new Button(); button.Width = 42;
    try { button.SetValue(Button.WidthProperty, "invalid"); }
    catch (InvalidOperationException error) { Console.WriteLine("wrong handler"); }
    catch (ArgumentException error) { Console.WriteLine("typed"); }
    try { button.Width = -1; }
    catch (ArgumentOutOfRangeException error) { Console.WriteLine("range"); }
    Console.WriteLine(button.Width);`);
  const decoded = loadAssembly(built.assembly);
  const expected = ['System.InvalidOperationException', 'System.ArgumentException', 'System.ArgumentOutOfRangeException'];
  assert.deepEqual(decoded.methods.flatMap(method => method.handlers.map(handler => handler.type)), expected);
  const pe = readPE(built.assembly);
  const metadata = JSON.parse(new TextDecoder().decode(pe.metadata.streams.get('#SF')));
  const catches = metadata.methods.flatMap(method => pe.methodBody(method.token).handlers.map(handler => pe.metadata.typeName(handler.catchType)));
  assert.deepEqual(catches, expected);
  assertOutput(built, 'typed\nrange\n42\n');
  const unsupported = {
    ...built.image,
    methods: built.image.methods.map(method => ({
      ...method, handlers: method.handlers.map(handler => ({...handler, type: 'Sample.CustomException'}))
    }))
  };
  assert.throws(() => emitAssembly(unsupported), /Unsupported canonical managed catch type/);
});

test('A15 canonical metadata reconstruction still rejects modified executable bytes before execution', () => {
  const built = build('Button button = new Button(); button.TabIndex = 123; Console.WriteLine(button.TabIndex);');
  const bytes = built.assembly.slice();
  const pe = readPE(bytes);
  const metadata = JSON.parse(new TextDecoder().decode(pe.metadata.streams.get('#SF')));
  const located = metadata.methods.map(method => {
    const body = pe.methodBody(method.token);
    const instruction = decodeInstructions(body.code).find(value => ['ldc.i4', 'ldc.i4.s'].includes(value.name) && value.operand === 123);
    return {body, instruction};
  }).find(value => value.instruction);
  assert(located, 'Find the value in the actual method body, which can be behind the generated entry wrapper');
  const {body, instruction} = located;
  bytes[body.fileOffset + body.headerSize + instruction.offset + 1] = 124;
  assert.throws(() => loadAssembly(bytes), /canonical/);
});

test('A15 approved XAML parse exceptions keep their exact metadata identity without admitting arbitrary exception types', () => {
  const built = build('try { throw new Exception("test"); } catch (Exception error) { Console.WriteLine("handled"); }');
  const retarget = type => ({...built.image,
    methods: built.image.methods.map(method => ({...method,
      handlers: method.handlers.map(handler => ({...handler, type}))}))});
  const name = 'Microsoft.UI.Xaml.Markup.XamlParseException';
  const decoded = loadAssembly(emitAssembly(retarget(name), {embedSources: false}));
  assert.deepEqual(decoded.methods.flatMap(method => method.handlers.map(handler => handler.type)), [name]);
  for (const unsupported of ['Sample.CustomException', 'RuntimeException', 'Example.XamlParseException']) {
    assert.throws(() => emitAssembly(retarget(unsupported)), /Unsupported canonical managed catch type/);
  }
});
