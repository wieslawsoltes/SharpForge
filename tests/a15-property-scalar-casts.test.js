import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';

const scalarTypes = [
  'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'nint', 'nuint', 'char', 'float', 'double', 'decimal', 'bool'
];
const prefix = 'using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;\n';

function operands(method, opcode) {
  const result = [];
  for (let offset = 0; offset < method.code.length; offset += 3) {
    if (method.code[offset] === opcode) result.push(method.code[offset + 1]);
  }
  return result;
}

test('A15 UI scalar casts retain their exact type for property reads and subclass object values', () => {
  const members = scalarTypes.flatMap((type, index) => [
    `public ${type} FromProperty${index}(DependencyProperty property) { return (${type})GetValue(property); }`,
    `public ${type} FromObject${index}(object value) { return (${type})value; }`
  ]).join('\n');
  const direct = scalarTypes.map((type, index) =>
    `static ${type} Direct${index}(DependencyObject owner, DependencyProperty property) {
      return (${type})owner.GetValue(property);
    }`).join('\n');
  const built = compile(prefix + `class ScalarReader : Control { ${members} }
    class P { ${direct} static void Main() { } }`);
  assert.equal(built.success, true, built.diagnostics.map(item => item.code + ': ' + item.message).join('\n'));
  const cast = frameworkBuiltin(findContracts('SharpForge.UI.Runtime', 'Cast', true)[0]);
  assert(cast);
  scalarTypes.forEach((type, index) => {
    for (const name of ['FromProperty', 'FromObject', 'Direct']) {
      const method = built.image.methods.find(value => value.name === name + index);
      assert(method, name + index);
      assert.equal(method.returnType, type);
      assert.equal(operands(method, Op.BUILTIN).filter(id => id === cast.id).length, 1, method.name);
      assert(operands(method, Op.CONST).some(id => built.image.constants[id] === type), method.name + ': exact cast type');
    }
  });
});

test('A15 wider scalar casts do not admit unrelated object unboxing outside the UI profile', () => {
  for (const type of ['long', 'ulong', 'decimal', 'char']) {
    const built = compile(`class P {
      static ${type} Read(object value) { return (${type})value; }
      static void Main() { }
    }`);
    assert.equal(built.success, false, type);
    assert(built.diagnostics.some(item => item.code === 'SF2200' && /runtime type check/.test(item.message)), type);
  }
});
