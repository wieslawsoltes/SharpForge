import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op, NumericType, numericMode} from '@sharpforge/bytecode';
import {emitAssemblyDetailed, intrinsicDefinition, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeMathBuiltin} from '../packages/cil/src/math-builtin-mapping.js';

const widths = [['sbyte', 'SByte', -128, 127], ['byte', 'Byte', 0, 255],
  ['short', 'Int16', -32768, 32767], ['ushort', 'UInt16', 0, 65535]];

function artifact(body, members = '') {
  const compiled = compileToIL(`using System; using M = System.Math;
    class P { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function output(compiled, expected) {
  for (const [engine, create] of [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ]) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
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

test('eight small extrema entries append after Sign with exact narrow results and parameter names', () => {
  const previous = BuiltinMap.get('Math.Sign#1:Double').id;
  for (const [index, [type, suffix]] of widths.entries()) {
    for (const [offset, name] of ['Min', 'Max'].entries()) {
      const entry = BuiltinMap.get(`Math.${name}#2:${suffix}`);
      assert.equal(entry.id, previous + index * 2 + offset + 1);
      assert.equal(entry.result, type);
      assert.deepEqual(entry.params, [type, type]);
      assert.deepEqual(entry.parameterNames, ['val1', 'val2']);
      assert.equal(entry.math.owner, 'System.Math');
      assert.equal(entry.math.name, name);
      assert.equal(entry.math.signature.returnType, type);
      assert.equal(intrinsicDefinition(entry.math)?.implementation, 'smallMathExtremum');
    }
  }
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
  assert.equal(BuiltinMap.get('Math.Min#2:Single').id, BuiltinMap.get('decimal.Round#3:MidpointRounding').id + 1);
  for (const suffix of ['Char', 'Boolean']) {
    for (const name of ['Min', 'Max']) assert.equal(BuiltinMap.get(`Math.${name}#2:${suffix}`), undefined);
  }
});

for (const [type, suffix, low, high] of widths) {
  test(`${type} source extrema retain result width through named evaluation, fields, arrays and boxing`, () => {
    const compiled = artifact(`${type} minimum = M.Min(val2: Read(2), val1: Read(1)); Console.WriteLine(minimum);
      ${type} maximum = System.Math.Max(val1: Read(1), val2: Read(2)); Console.WriteLine(maximum);
      Saved = maximum; ${type}[] values = new ${type}[] { minimum, Saved }; object boxed = values[1];
      Saved = (${type})0; values[1] = (${type})0;
      Console.WriteLine(boxed.GetType().FullName); Console.WriteLine(boxed);
      Console.WriteLine(Math.Min(maximum, maximum)); Console.WriteLine(Math.Max(minimum, minimum));`,
    `static ${type} Saved; static ${type} Read(int id) { Console.Write(id); return id == 1 ? (${type})${low} : (${type})${high}; }`);
    output(compiled, `21${low}\n12${high}\nSystem.${suffix}\n${high}\n${high}\n${low}\n`);
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
      const ids = builtinIds(image);
      for (const name of ['Min', 'Max']) assert(ids.includes(BuiltinMap.get(`Math.${name}#2:${suffix}`).id));
    }
  });
}

test('actual small/mixed overload selection keeps wider numeric families and Char promotion coherent', () => {
  const cases = [
    ['sbyte a = -1; byte b = 2;', 'Int16', '-1'],
    ['short a = -3; ushort b = 4;', 'Int32', '-3'],
    ["char a = 'B'; byte b = 65;", 'UInt16', '65'],
    ["char a = 'B'; char b = 'A';", 'UInt16', '65'],
    ['byte a = 1; uint b = uint.MaxValue;', 'UInt32', '1'],
    ['short a = -1; uint b = uint.MaxValue;', 'Int64', '-1'],
    ['ushort a = 1; ulong b = ulong.MaxValue;', 'UInt64', '1'],
    ['byte a = 1; float b = 1.5f;', 'Single', '1'],
    ['short a = -1; double b = 1.5;', 'Double', '-1'],
    ['ushort a = 1; decimal b = 1.5m;', 'Decimal', '1']
  ];
  for (const [declarations, suffix, expected] of cases) {
    const compiled = artifact(`${declarations} var selected = Math.Min(a, b);
      ${suffix === 'Double' ? 'Console.WriteLine(selected);' : 'object boxed = selected; Console.WriteLine(boxed.GetType().FullName); Console.WriteLine(boxed);'}`);
    output(compiled, suffix === 'Double' ? `${expected}\n` : `System.${suffix}\n${expected}\n`);
    const entry = BuiltinMap.get(suffix === 'Double' ? 'Math.Min' : `Math.Min#2:${suffix}`);
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) assert(builtinIds(image).includes(entry.id));
  }
});

function wireImage(entry, type, left, right) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0,
    constants: [left, right].map(value => ({scalar: type, value: String(value)})),
    sources: [], types: [], statics: [], sequencePoints: [], methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main',
      isStatic: true, parameters: [], returnType: 'void', locals: [], handlers: [], code: Int32Array.from([
        Op.CONST, 0, numericMode(type), Op.CONST, 1, numericMode(type), Op.BUILTIN, entry.id, 2,
        Op.CONVERT, NumericType.int, numericMode(type),
        Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0
      ])}]};
}

test('new narrow calls and previously serialized legacy/Int32 calls keep their own canonical wire IDs', () => {
  for (const name of ['Min', 'Max']) {
    const cases = [['', 'int', -4, 3], [':Int32', 'int', -4, 3],
      ...widths.map(([type, suffix, low, high]) => [':' + suffix, type, low, high])];
    for (const [suffix, type, low, high] of cases) {
      const entry = BuiltinMap.get('Math.' + name + (suffix ? '#2' + suffix : ''));
      const image = wireImage(entry, type, low, high), assembly = emitAssemblyDetailed(image).bytes;
      assert.equal(loadAssembly(assembly).methods[0].code[7], entry.id);
      output({image, assembly}, (name === 'Min' ? low : high) + '\n');
    }
  }
});

test('small extrema decoder and source binder reject false signatures, arities, names and destinations', () => {
  for (const [type, suffix] of widths) {
    const target = {owner: 'System.Math', name: 'Min', token: 0x0a000001,
      sig: {kind: 'method', isStatic: true, returnType: type, parameters: [type, type]}};
    const span = [{name: 'call', operand: target.token}, {name: 'nop'}];
    assert.equal(decodeMathBuiltin(target, span), BuiltinMap.get(`Math.Min#2:${suffix}`));
    assert.equal(decodeMathBuiltin(target, span.slice(0, 1)), null);
    for (const replacement of [{returnType: 'int'}, {parameters: [type, 'int']}, {parameters: [type]},
      {parameters: [type + '&', type]}, {isStatic: false}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeMathBuiltin({...target, sig: {...target.sig, ...replacement}}, span), null);
    }
  }
  for (const body of ['Math.Min(true, false);', 'Math.Max(val1: (byte)1);',
    'Math.Min(x: (short)1, y: (short)2);', 'bool result = Math.Max((ushort)1, (ushort)2);',
    'byte result = Math.Min((short)(-1), (byte)2);']) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
  }
});
