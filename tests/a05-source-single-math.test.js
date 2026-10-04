import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op, numericMode, singleToInt32Bits} from '@sharpforge/bytecode';
import {emitAssemblyDetailed, intrinsicDefinition, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeMathBuiltin} from '../packages/cil/src/math-builtin-mapping.js';

function artifact(body, members = '') {
  const compiled = compileToIL(`using System; using M = System.Math;
    class P { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function engines(compiled) {
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function output(compiled, expected) {
  for (const [engine, create] of engines(compiled)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
}

function staticValue(vm, name) {
  const slot = vm.inspector ? [...vm.inspector.fields.values()].find(field => field.name === name)?.token
    : vm.image.statics.findIndex(field => field.name === 'P.' + name);
  assert(slot !== undefined && slot !== -1, 'Missing field ' + name);
  return vm.inspector ? vm.statics.get(slot) : vm.statics[slot];
}

function builtinIds(image) {
  return image.methods.flatMap(method => {
    const result = [];
    for (let index = 0; index < method.code.length; index += 3) {
      if (method.code[index] === Op.BUILTIN) result.push(method.code[index + 1]);
    }
    return result;
  });
}

test('Single extrema append after Round modes with exact existing CLR descriptors', () => {
  const previous = BuiltinMap.get('decimal.Round#3:MidpointRounding').id;
  for (const [index, name] of ['Min', 'Max'].entries()) {
    const entry = BuiltinMap.get(`Math.${name}#2:Single`);
    assert.equal(entry.id, previous + index + 1);
    assert.equal(entry.result, 'float');
    assert.deepEqual(entry.params, ['float', 'float']);
    assert.deepEqual(entry.parameterNames, ['val1', 'val2']);
    assert.equal(entry.math.owner, 'System.Math');
    assert.equal(entry.math.name, name);
    assert.equal(entry.math.signature.returnType, 'float');
    assert(intrinsicDefinition(entry.math));
    assert(Object.isFrozen(entry.math.signature));
  }
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
  assert.equal(BuiltinMap.get('Math.Min#2:Int32').id, BuiltinMap.get('Math.Sign#1:Decimal').id + 1);
});

test('Single results retain float assignment, array storage, boxing and named evaluation order', () => {
  const compiled = artifact(`float minimum = M.Min(val2: Read(2), val1: Read(1)); Console.WriteLine(minimum);
    float maximum = System.Math.Max(val1: Read(1), val2: Read(2)); Console.WriteLine(maximum);
    float[] values = new float[] { minimum, maximum }; object boxed = values[1];
    Console.WriteLine(boxed.GetType().FullName); Console.WriteLine(boxed);`,
  'static float Read(int id) { Console.Write(id); return id == 1 ? 1.5f : 2.25f; }');
  output(compiled, '211.5\n122.25\nSystem.Single\n2.25\n');
  for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
    const ids = builtinIds(image);
    assert(ids.includes(BuiltinMap.get('Math.Min#2:Single').id));
    assert(ids.includes(BuiltinMap.get('Math.Max#2:Single').id));
  }
});

test('typed source extrema expose Single zeros, subnormals, finite bounds, infinities and NaNs', () => {
  const expressions = [
    ['MinZero', 'Math.Min(0f, -0.0f)', -2147483648], ['MaxZero', 'Math.Max(-0.0f, 0f)', 0],
    ['NegativeZeros', 'Math.Max(-0.0f, -0.0f)', -2147483648],
    ['Tiny', 'Math.Max(float.Epsilon, 0f)', 1], ['NegativeTiny', 'Math.Min(-float.Epsilon, 0f)', -2147483647],
    ['Finite', 'Math.Min(float.MaxValue, float.PositiveInfinity)', 0x7f7fffff],
    ['Infinity', 'Math.Max(float.MaxValue, float.PositiveInfinity)', 0x7f800000],
    ['NegativeInfinity', 'Math.Min(float.NegativeInfinity, float.MinValue)', -8388608],
    ['FirstNaN', 'Math.Min(float.NaN, 1f)', null], ['SecondNaN', 'Math.Max(1f, float.NaN)', null]
  ];
  const compiled = artifact(expressions.map(([name, expression]) => `${name} = ${expression};`).join('\n'),
    expressions.map(([name]) => `static float ${name};`).join('\n'));
  for (const [engine, create] of engines(compiled)) {
    const vm = create(), result = vm.run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    for (const [name, , expected] of expressions) {
      const value = staticValue(vm, name);
      assert.equal(value.float, 'r4', `${engine}: ${name}`);
      if (expected === null) assert(Number.isNaN(value.value), `${engine}: ${name}`);
      else assert.equal(singleToInt32Bits(value), expected, `${engine}: ${name}`);
    }
  }
});

test('float/integral overloads use Single conversions while mixed Double calls keep Double', () => {
  const compiled = artifact(`long wide = 16777217L; uint unsigned = uint.MaxValue; ulong widest = ulong.MaxValue;
    Wide = Math.Max(1f, wide); Unsigned = Math.Max(1f, unsigned); Widest = Math.Max(1f, widest);
    object single = Math.Max(1f, wide); Console.WriteLine(single.GetType().FullName);
    object mixed = Math.Min(1f, 2.5); Console.WriteLine(mixed.GetType().FullName); Console.WriteLine(mixed);
    byte b = 1; short s = -2; char c = 'A';
    Console.WriteLine(Math.Min(b, s)); Console.WriteLine(Math.Max(c, b));
    Console.WriteLine(Math.Min(1m, 2m)); Console.WriteLine(Math.Max(1u, 2u));`,
  'static float Wide; static float Unsigned; static float Widest;');
  for (const [engine, create] of engines(compiled)) {
    const vm = create(), result = vm.run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, 'System.Single\nSystem.Double\n1\n-2\n65\n1\n2\n', engine);
    for (const [name, expected] of [['Wide', 0x4b800000], ['Unsigned', 0x4f800000], ['Widest', 0x5f800000]]) {
      const value = staticValue(vm, name);
      assert.equal(value.float, 'r4');
      assert.equal(singleToInt32Bits(value), expected, `${engine}: ${name}`);
    }
  }
});

function wireImage(entry) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0,
    constants: [{scalar: 'float', value: '1.5'}, {scalar: 'float', value: '2.25'}],
    sources: [], types: [], statics: [], sequencePoints: [], methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main',
      isStatic: true, parameters: [], returnType: 'void', locals: [], handlers: [], code: Int32Array.from([
        Op.CONST, 0, numericMode('float'), Op.CONST, 1, numericMode('float'), Op.BUILTIN, entry.id, 2,
        Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0
      ])}]};
}

test('old numeric and new Single wire calls retain their own canonical round-trip identities', () => {
  for (const name of ['Min', 'Max']) {
    for (const suffix of ['', '#2:Single']) {
      const entry = BuiltinMap.get('Math.' + name + suffix), image = wireImage(entry);
      const assembly = emitAssemblyDetailed(image).bytes, loaded = loadAssembly(assembly);
      assert.equal(loaded.methods[0].code[7], entry.id);
      output({image, assembly}, name === 'Min' ? '1.5\n' : '2.25\n');
    }
  }
});

test('Single decoder requires the exact signature and source keeps ordinary overload diagnostics', () => {
  const target = {owner: 'System.Math', name: 'Min', token: 0x0a000001,
    sig: {kind: 'method', isStatic: true, returnType: 'float', parameters: ['float', 'float']}};
  const span = [{name: 'call', operand: target.token}, {name: 'nop'}];
  assert.equal(decodeMathBuiltin(target, span), BuiltinMap.get('Math.Min#2:Single'));
  assert.equal(decodeMathBuiltin(target, span.slice(0, 1)), null);
  for (const owner of ['System.MathF', 'Other.Math']) assert.equal(decodeMathBuiltin({...target, owner}, span), null);
  for (const replacement of [{returnType: 'double'}, {parameters: ['float', 'double']}, {parameters: ['float&', 'float']},
    {isStatic: false}, {genericArity: 1}, {callingConvention: 5}]) {
    assert.equal(decodeMathBuiltin({...target, sig: {...target.sig, ...replacement}}, span), null);
  }
  for (const body of ['Math.Min(1f, 1m);', 'Math.Max(x: 1f, y: 2f);', 'int value = Math.Min(1f, 2f);',
    'float value = Math.Min(1f, 2.0);', 'Math.Max(1f);']) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
  }
});
