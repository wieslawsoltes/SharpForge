import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op, float, int64BitsToDouble, doubleToInt64Bits, numericMode} from '@sharpforge/bytecode';
import {emitAssemblyDetailed, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {builtin} from '../packages/runtime/src/execution/source-builtins.js';

const services = () => ({heap: new ManagedHeap(), value: VirtualMachine.prototype.value});
const invoke = (vm, name, first, second) => {
  // Keep V8 from choosing a double-elements array and canonicalizing input NaNs before the call.
  const args = [null, null]; args[0] = first; args[1] = second;
  return builtin(vm, BuiltinMap.get('Math.' + name).id, args);
};

test('legacy source extrema return a selected quiet-NaN Number without changing its bits', () => {
  const vm = services();
  const firstNaN = int64BitsToDouble(0x7ff8000000012345n);
  const secondNaN = int64BitsToDouble(BigInt.asIntN(64, 0xfff8000000054321n));
  for (const name of ['Min', 'Max']) {
    for (const [first, second, selected] of [
      [firstNaN, float(1), firstNaN], [float(1), secondNaN, secondNaN],
      [firstNaN, secondNaN, firstNaN], [secondNaN, firstNaN, secondNaN]
    ]) {
      for (const wrapped of [true, false]) {
        const result = invoke(vm, name, wrapped ? first : first.value, wrapped ? second : second.value);
        assert.equal(typeof result, 'number');
        assert.equal(doubleToInt64Bits(result), doubleToInt64Bits(selected), `${name} wrapped=${wrapped} first=${doubleToInt64Bits(first)} second=${doubleToInt64Bits(second)}`);
      }
    }
  }
});

test('released Int32 and Double wire results stay primitive Numbers including signed zeros', () => {
  const vm = services();
  const cases = [[-2147483648, 2147483647, -2147483648, 2147483647], [-4, 3, -4, 3],
    [-4.5, 3.25, -4.5, 3.25], [0, -0, -0, 0], [-0, 0, -0, 0], [-0, -0, -0, -0],
    [-Infinity, Infinity, -Infinity, Infinity], [-Number.MIN_VALUE, 0, -Number.MIN_VALUE, 0]];
  for (const [first, second, minimum, maximum] of cases) {
    for (const [name, expected] of [['Min', minimum], ['Max', maximum]]) {
      const result = invoke(vm, name, first, second);
      assert.equal(typeof result, 'number');
      assert(Object.is(result, expected), `${name}(${first}, ${second})`);
    }
  }
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
});

test('legacy non-Number fallback and tagged typed dispatch retain their existing contracts', () => {
  const vm = services();
  assert.equal(invoke(vm, 'Min', '4', 2), 2);
  assert.equal(invoke(vm, 'Max', null, -2), 0);
  assert(Number.isNaN(invoke(vm, 'Min', undefined, 2)));
  assert.throws(() => invoke(vm, 'Min', 1n, 2), TypeError);
  assert.throws(() => invoke(vm, 'Max', NaN, 2n), TypeError);
  const entry = BuiltinMap.get('Math.Max#2:UInt64');
  const result = builtin(vm, entry.id, [-1n, 0n]);
  assert.equal(result, -1n);
  assert.equal(typeof result, 'bigint');
});

function engines(compiled) {
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function staticValue(vm, name) {
  const slot = vm.inspector ? [...vm.inspector.fields.values()].find(field => field.name === name)?.token
    : vm.image.statics.findIndex(field => field.name === 'P.' + name);
  assert(slot !== undefined && slot !== -1);
  return vm.inspector ? vm.statics.get(slot) : vm.statics[slot];
}

for (const name of ['Min', 'Max']) {
  test(`compiled legacy Double ${name} retains input NaN bits and zero selection in every engine`, () => {
    const compiled = compileToIL(`using System; class P {
      static double NaNInput; static double First; static double Second; static double Zero;
      static void Main() {
        NaNInput = double.NaN; First = Math.${name}(NaNInput, 1.25); Second = Math.${name}(1.25, NaNInput);
        Zero = Math.${name}(-0.0, 0.0);
      }
    }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const expectedId = BuiltinMap.get('Math.' + name).id;
    assert(compiled.image.methods.some(method => {
      for (let index = 0; index < method.code.length; index += 3) {
        if (method.code[index] === Op.BUILTIN && method.code[index + 1] === expectedId) return true;
      }
      return false;
    }), 'exercise the released numeric wire');
    for (const [engine, create] of engines(compiled)) {
      const vm = create(), result = vm.run();
      assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
      const inputBits = doubleToInt64Bits(staticValue(vm, 'NaNInput'));
      assert.equal(doubleToInt64Bits(staticValue(vm, 'First')), inputBits, engine);
      assert.equal(doubleToInt64Bits(staticValue(vm, 'Second')), inputBits, engine);
      assert.equal(doubleToInt64Bits(staticValue(vm, 'Zero')), name === 'Min' ? -(1n << 63n) : 0n, engine);
    }
  });
}

function wireImage(id, floating) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0,
    constants: floating ? [{scalar: 'double', value: '-4.5'}, {scalar: 'double', value: '3.25'}] : [-4, 3],
    sources: [], types: [], statics: [], sequencePoints: [], methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main',
      isStatic: true, parameters: [], returnType: 'void', locals: [], handlers: [], code: Int32Array.from([
        Op.CONST, 0, floating ? numericMode('double') : 0, Op.CONST, 1, floating ? numericMode('double') : 0,
        Op.BUILTIN, id, 2, Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0
      ])}]};
}

test('independent released int/double wire images keep canonical reload and ordinary outputs', () => {
  for (const [name, id] of [['Min', 3], ['Max', 4]]) {
    for (const floating of [false, true]) {
      const image = wireImage(id, floating), assembly = emitAssemblyDetailed(image).bytes;
      const loaded = loadAssembly(assembly);
      assert.equal(loaded.methods[0].code[7], id);
      const expected = name === 'Min' ? floating ? '-4.5\n' : '-4\n' : floating ? '3.25\n' : '3\n';
      for (const [engine, create] of engines({image, assembly})) {
        const result = create().run();
        assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
        assert.equal(result.output, expected, engine);
      }
    }
  }
});
