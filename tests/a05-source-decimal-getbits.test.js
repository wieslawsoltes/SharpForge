import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalBits, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function engines(body, members = '') {
  const compiled = compileToIL(`using System; using D = System.Decimal;
    class Program { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function staticValue(vm, name) {
  const slot = vm.inspector
    ? [...vm.inspector.fields.values()].find(field => field.name === name)?.token
    : vm.image.statics.findIndex(field => field.name === 'Program.' + name);
  assert(slot !== undefined && slot !== -1, 'Missing ' + name);
  return vm.inspector ? vm.statics.get(slot) : vm.statics[slot];
}

test('GetBits appends the exact existing int-array descriptor and named d parameter', () => {
  const entry = BuiltinMap.get('decimal.GetBits#1');
  assert.equal(entry.id, BuiltinMap.get('decimal.ToDouble#1').id + 1);
  assert(decimalIntrinsicDefinitions.includes(entry.decimal));
  assert.deepEqual(entry.params, ['decimal']);
  assert.deepEqual(entry.parameterNames, ['d']);
  assert.equal(entry.result, 'int[]');
  assert.equal(entry.decimal.returnType, 'int[]');
  assert(Object.isFrozen(entry));
});

test('GetBits preserves all coefficient limbs and independent sign/scale on every engine', () => {
  const cases = [
    ['0m', [0, 0, 0, 0]], ['1.2300m', [12300, 0, 0, 262144]],
    ['-1.2300m', [12300, 0, 0, -2147221504]], ['0.0000m', [0, 0, 0, 262144]],
    ['decimal.Parse("-0.0000")', [0, 0, 0, -2147221504]],
    ['0.0000000000000000000000000001m', [1, 0, 0, 1835008]],
    ['4294967295m', [-1, 0, 0, 0]], ['4294967296m', [0, 1, 0, 0]],
    ['18446744073709551615m', [-1, -1, 0, 0]], ['18446744073709551616m', [0, 0, 1, 0]],
    ['decimal.MaxValue', [-1, -1, -1, 0]], ['decimal.MinValue', [-1, -1, -1, -2147483648]]
  ];
  const body = cases.map(([value]) => `{
    int[] words = D.GetBits(${value}); Console.WriteLine(words.Length);
    Console.WriteLine(words[0]); Console.WriteLine(words[1]); Console.WriteLine(words[2]); Console.WriteLine(words[3]);
  }`).join('\n');
  const expected = cases.map(([, words]) => '4\n' + words.join('\n') + '\n').join('');
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
});

test('GetBits returns independently owned mutable arrays rooted across collection without changing the Decimal', () => {
  const body = `Original = -1.2300m; First = System.Decimal.GetBits(d: Read());
    GC.Collect(); Second = decimal.GetBits(Original); First[0] = 999; First[3] = 0;
    GC.Collect(); Console.WriteLine(First == Second);
    Console.WriteLine(Second[0]); Console.WriteLine(Second[3]); Console.WriteLine(Original);
    Console.WriteLine(Second.GetType().FullName);`;
  const members = `static decimal Original; static int[] First; static int[] Second;
    static decimal Read() { Console.Write("R"); return Original; }`;
  for (const [engine, create] of engines(body, members)) {
    const vm = create(), result = vm.run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, 'RFalse\n12300\n-2147221504\n-1.2300\nSystem.Int32[]\n', engine);
    const first = staticValue(vm, 'First'), second = staticValue(vm, 'Second');
    assert.notDeepEqual(first, second, engine);
    assert.deepEqual(vm.heap.get(first).data, [999, 0, 0, 0], engine);
    assert.deepEqual(vm.heap.get(second).data, [12300, 0, 0, -2147221504], engine);
    for (const reference of [first, second]) {
      const record = vm.heap.get(reference);
      assert.equal(record.kind, 'array', engine);
      assert.equal(record.methodTable.elementType.name, 'System.Int32', engine);
      assert.equal(record.data.length, 4, engine);
    }
    assert.deepEqual(decimalBits(staticValue(vm, 'Original')), [12300, 0, 0, -2147221504], engine);
  }
});

test('GetBits permits ordinary integral-to-Decimal widening while keeping array result typing', () => {
  const body = `int[] words = decimal.GetBits(7);
    object array = words; Console.WriteLine(words.Length); Console.WriteLine(words[0]);
    Console.WriteLine(array.GetType().FullName);`;
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, '4\n7\nSystem.Int32[]\n', engine);
  }
});

test('GetBits rejects incompatible arguments, wrong result types and destination/span overloads', () => {
  for (const body of [
    'decimal.GetBits();', 'decimal.GetBits(1.0);', 'decimal.GetBits(null);',
    'decimal.GetBits(value: 1m);', 'decimal.GetBits(1m, new int[4]);',
    'int value = decimal.GetBits(1m);', 'long[] value = decimal.GetBits(1m);'
  ]) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
  }
  const target = {owner: 'System.Decimal', name: 'GetBits',
    sig: {kind: 'method', isStatic: true, returnType: 'int[]', parameters: ['System.Decimal']}};
  assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get('decimal.GetBits#1'));
  for (const replacement of [{returnType: 'int'}, {returnType: 'long[]'}, {isStatic: false},
    {parameters: ['System.Decimal&']}, {parameters: ['double']}, {parameters: ['System.Decimal', 'int[]']},
    {returnType: 'int', parameters: ['System.Decimal', 'System.Span`1<int>']}, {genericArity: 1}, {callingConvention: 5}]) {
    assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null);
  }
});
