import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {registeredEnumConstant} from '../packages/compiler/src/constants/registered-enum-constant.js';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {FieldSymbol, DeclarationModifiers} from '../packages/compiler/src/symbols/members.js';

const orientation = 'Microsoft.UI.Xaml.Controls.Orientation';
const visibility = 'Microsoft.UI.Xaml.Visibility';
// A declared delegate selects semantic generation without introducing unsupported runtime behavior.
const source = `using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
delegate void Marker();
class Program {
  static Orientation GetMode() { return Orientation.Horizontal; }
  static bool IsHorizontal(Orientation mode) { return mode == Orientation.Horizontal; }
  static void Main() {
    Orientation mode = Orientation.Horizontal;
    Console.WriteLine(IsHorizontal(mode));
    Console.WriteLine(IsHorizontal(Orientation.Vertical));
    Console.WriteLine(GetMode() == mode);
    Visibility state = Visibility.Collapsed;
    Console.WriteLine(state == Visibility.Collapsed);
    var panel = new StackPanel();
    panel.Orientation = Orientation.Horizontal;
    panel.Visibility = Visibility.Collapsed;
    Console.WriteLine(panel.Orientation == mode);
    Console.WriteLine(panel.Visibility == state);
  }
}`;
let compiled;

for (const engine of ['source', 'cil']) {
  test(`registered enums ${engine}: semantic named constants retain local, argument, return and property types`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    assert.equal(compiled.semantic?.generated, true, 'the regression must exercise semantic generation');
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const values = [];
    vm.onWrite = event => {
      if (event.property === 'Orientation' || event.property === 'Visibility') {
        values.push([event.property, vm.platform.native(event.value)]);
        if (engine === 'source') {
          assert.equal(event.value.enumType, event.property === 'Orientation' ? orientation : visibility);
        }
      }
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'True\nFalse\nTrue\nTrue\nTrue\nTrue\n');
      assert.deepEqual(values, [['Orientation', 1], ['Visibility', 1]]);
    } finally { vm.onWrite = null; vm.stop(); }
  });
}

test('registered enum constants use the released enum instruction and canonical registry identities', () => {
  compiled ??= compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const entries = [];
  for (const method of compiled.image.methods) {
    for (let offset = 0; offset < method.code.length; offset += 3) {
      if (method.code[offset] === Op.ENUM) entries.push([enumTypes[method.code[offset + 1]], method.code[offset + 2]]);
    }
  }
  assert(entries.some(([type, value]) => type === orientation && value === 0));
  assert(entries.some(([type, value]) => type === orientation && value === 1));
  assert(entries.some(([type, value]) => type === visibility && value === 1));
  assert(entries.every(([type]) => type === orientation || type === visibility));
});

test('registered enum binding still rejects implicit numeric and unrelated enum assignments', () => {
  for (const declaration of ['int value = Orientation.Horizontal;', 'Orientation value = Visibility.Collapsed;']) {
    const result = compile(`using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
      class Program { static void Main() { ${declaration} } }`);
    assert.equal(result.success, false, declaration);
    assert(result.diagnostics.some(item => item.code === 'CS0029' || item.code === 'CS0266'), JSON.stringify(result.diagnostics));
  }
});

test('registered enum boxing remains an explicit semantic execution-profile boundary', () => {
  const result = compile(`using System; using Microsoft.UI.Xaml.Controls; delegate void Marker();
    class Program { static void Main() { object value = Orientation.Horizontal; Console.WriteLine(value); } }`);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'SF2200' && item.message.includes('boxing an enum value')),
    JSON.stringify(result.diagnostics));
});

test('source enum constants retain their existing integer lowering', () => {
  const result = compileToIL(`using System; enum Local { Zero, One }
    class Program { static void Main() { Console.WriteLine((int)Local.One); } }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of [new VirtualMachine(result.image), new CilVirtualMachine(result.assembly)]) {
    try {
      const execution = vm.run();
      assert.equal(execution.state, 'terminated', execution.fault?.stack);
      assert.equal(execution.output, '1\n');
    } finally { vm.stop(); }
  }
});

test('registered enum adaptation preserves public field values and rejects unregistered or mismatched constants', () => {
  const registry = new RegistryBridge();
  const type = registry.typeFromName(orientation);
  const field = type.getMembers('Horizontal')[0];
  const value = registeredEnumConstant(field, registry);
  assert.equal(value.isEnum, true);
  assert.equal(value.enumType, type);
  assert.equal(value.value, 1);
  assert.equal(field.constantValue, 1, 'public FieldSymbol constants remain primitive numbers');
  assert.equal(registeredEnumConstant(field, {registryName: () => null}), null);
  for (const overrides of [{name: 'Missing'}, {modifiers: 0}, {constantValue: {value: 2}}, {constantValue: {value: 2147483648}}]) {
    const candidate = new FieldSymbol({name: 'Horizontal', type, containingSymbol: type,
      modifiers: DeclarationModifiers.Const, constantValue: {value: 1}, ...overrides});
    assert.equal(registeredEnumConstant(candidate, registry), null);
  }
});
