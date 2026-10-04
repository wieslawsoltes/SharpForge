import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op, numericMode} from '@sharpforge/bytecode';
import {decodeInstructions, emitAssemblyDetailed, intrinsicDefinition, loadAssembly, readPE} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeMathBuiltin} from '../packages/cil/src/math-builtin-mapping.js';

const overloads = [['sbyte', 'SByte'], ['short', 'Int16'], ['int', 'Int32'],
  ['long', 'Int64'], ['float', 'Single'], ['double', 'Double']];
const nanMessage = 'Function does not accept floating point Not-a-Number values.';

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

function builtinIds(image) {
  return image.methods.flatMap(method => {
    const result = [];
    for (let index = 0; index < method.code.length; index += 3) {
      if (method.code[index] === Op.BUILTIN) result.push(method.code[index + 1]);
    }
    return result;
  });
}

test('six exact Sign descriptors append after Single extrema without changing previous identities', () => {
  const previous = BuiltinMap.get('Math.Max#2:Single').id;
  for (const [index, [type, suffix]] of overloads.entries()) {
    const entry = BuiltinMap.get(`Math.Sign#1:${suffix}`);
    assert.equal(entry.id, previous + index + 1);
    assert.equal(entry.result, 'int');
    assert.equal(entry.min, 1);
    assert.equal(entry.max, 1);
    assert.deepEqual(entry.params, [type]);
    assert.deepEqual(entry.parameterNames, ['value']);
    assert.equal(entry.math.owner, 'System.Math');
    assert.equal(entry.math.name, 'Sign');
    assert.equal(entry.math.signature.returnType, 'int');
    assert.equal(intrinsicDefinition(entry.math)?.implementation, 'mathSign');
    assert(Object.isFrozen(entry));
    assert(Object.isFrozen(entry.math.signature));
  }
  assert.equal(BuiltinMap.get('Math.Sign#1:Decimal').id, BuiltinMap.get('decimal.GetBits#1').id + 1);
  assert.equal(BuiltinMap.get('Math.Min#2:Int32').id, BuiltinMap.get('Math.Sign#1:Decimal').id + 1);
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
});

for (const [type, suffix] of overloads) {
  test(`source ${type} Sign preserves Int32 result storage, boxing and named argument evaluation`, () => {
    const compiled = artifact(`int sign = M.Sign(value: Read()); int[] signs = new int[] { sign };
      object boxed = signs[0]; signs[0] = 0; Console.WriteLine(boxed); Console.WriteLine(boxed.GetType().FullName);
      Console.WriteLine(sign + 2); Console.WriteLine(System.Math.Sign((${type})0));`,
    `static ${type} Read() { Console.Write("R"); return (${type})(-1); }`);
    output(compiled, 'R-1\nSystem.Int32\n1\n0\n');
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
      assert(builtinIds(image).includes(BuiltinMap.get(`Math.Sign#1:${suffix}`).id));
    }
  });
}

test('source Sign covers signed minima, floating boundaries, subnormals, infinities and either zero sign', () => {
  const cases = [
    ['sbyte.MinValue', -1], ['sbyte.MaxValue', 1], ['short.MinValue', -1], ['short.MaxValue', 1],
    ['int.MinValue', -1], ['int.MaxValue', 1], ['long.MinValue', -1], ['long.MaxValue', 1],
    ['float.MinValue', -1], ['float.MaxValue', 1], ['-float.Epsilon', -1], ['float.Epsilon', 1],
    ['float.NegativeInfinity', -1], ['float.PositiveInfinity', 1], ['-0.0f', 0], ['0f', 0],
    ['double.MinValue', -1], ['double.MaxValue', 1], ['-double.Epsilon', -1], ['double.Epsilon', 1],
    ['double.NegativeInfinity', -1], ['double.PositiveInfinity', 1], ['-0.0', 0], ['0.0', 0],
    ['decimal.MinValue', -1], ['decimal.MaxValue', 1], ['0.0000m', 0]
  ];
  output(artifact(cases.map(([expression]) => `Console.WriteLine(Math.Sign(${expression}));`).join('\n')),
    cases.map(([, expected]) => expected + '\n').join(''));
});

for (const type of ['float', 'double']) {
  test(`source ${type} Sign NaN uses the same managed fault across all engines`, () => {
    const compiled = artifact(`Console.WriteLine(Math.Sign(${type}.NaN));`);
    for (const [engine, create] of engines(compiled)) {
      const result = create().run();
      assert.equal(result.state, 'faulted', engine);
      assert.equal(result.fault.name, 'ArithmeticException', engine);
      assert.equal(result.fault.message, nanMessage, engine);
      assert.equal(result.output, '', engine);
    }
  });
}

test('existing better-conversion rules promote byte, ushort, char and uint to exact signed overloads', () => {
  for (const [declaration, suffix, expected] of [
    ['byte value = byte.MaxValue;', 'Int16', 1], ['ushort value = ushort.MaxValue;', 'Int32', 1],
    ["char value = 'A';", 'Int32', 1], ['uint value = uint.MaxValue;', 'Int64', 1]
  ]) {
    const compiled = artifact(`${declaration} Console.WriteLine(Math.Sign(value));`);
    output(compiled, expected + '\n');
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
      assert(builtinIds(image).includes(BuiltinMap.get(`Math.Sign#1:${suffix}`).id), declaration);
    }
  }
});

test('UInt64 Sign has the real floating-versus-Decimal ambiguity and explicit casts repair it', () => {
  for (const expression of ['Math.Sign(value)', 'M.Sign(value: value)', 'Math.Sign(ulong.MaxValue)',
    'Math.Sign(choose ? small : wide)']) {
    const compiled = compileToIL(`using System; using M = System.Math; class P { static void Main() {
      ulong value = ulong.MaxValue; uint small = 1; ulong wide = ulong.MaxValue; bool choose = true;
      Console.WriteLine(${expression}); } }`);
    assert.equal(compiled.success, false, expression);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.code === 'CS0121' && diagnostic.severity === 'error'), expression);
  }
  output(artifact(`ulong value = ulong.MaxValue;
    Console.WriteLine(Math.Sign((decimal)value)); Console.WriteLine(Math.Sign((float)value));
    Console.WriteLine(Math.Sign((double)value)); Console.WriteLine(Math.Sign(checked((long)0UL)));`),
  '1\n1\n1\n0\n');
});

function wireImage(entry, type, value) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [{scalar: type, value}],
    sources: [], types: [], statics: [], sequencePoints: [], methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main',
      isStatic: true, parameters: [], returnType: 'void', locals: [], handlers: [], code: Int32Array.from([
        Op.CONST, 0, numericMode(type), Op.BUILTIN, entry.id, 1,
        Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0
      ])}]};
}

test('independent old Decimal and new scalar wire images retain canonical identity and results', () => {
  const cases = [['Decimal', 'decimal', [4, 0, 0, -2147483648]],
    ...overloads.map(([type, suffix]) => [suffix, type, '-4'])];
  for (const [suffix, type, value] of cases) {
    const entry = BuiltinMap.get(`Math.Sign#1:${suffix}`), image = wireImage(entry, type, value);
    const assembly = emitAssemblyDetailed(image).bytes, loaded = loadAssembly(assembly);
    assert.equal(loaded.methods[0].code[4], entry.id, suffix);
    output({image, assembly}, '-1\n');
  }
});

test('unary decoder preserves exact signatures and terminal canonical call markers', () => {
  for (const [type, suffix] of overloads) {
    const target = {owner: 'System.Math', name: 'Sign', token: 0x0a000001,
      sig: {kind: 'method', isStatic: true, returnType: 'int', parameters: [type]}};
    const call = {name: 'call', operand: target.token}, marker = {name: 'nop'};
    assert.equal(decodeMathBuiltin(target, [call, marker]), BuiltinMap.get(`Math.Sign#1:${suffix}`));
    for (const span of [[call], [marker, call], [call, marker, marker], [call, call, marker],
      [{...call, name: 'callvirt'}, marker], [{...call, operand: 0x0a000002}, marker]]) {
      assert.equal(decodeMathBuiltin(target, span), null);
    }
    for (const owner of ['System.MathF', 'System.Decimal', 'Other.Math']) {
      assert.equal(decodeMathBuiltin({...target, owner}, [call, marker]), null);
    }
    for (const replacement of [{returnType: 'double'}, {returnType: 'long'}, {parameters: []}, {parameters: [type, type]},
      {parameters: [type + '&']}, {isStatic: false}, {genericArity: 1}, {callingConvention: 5}, {explicitThis: true}, {sentinel: 0}]) {
      assert.equal(decodeMathBuiltin({...target, sig: {...target.sig, ...replacement}}, [call, marker]), null);
    }
  }
});

test('full unary canonical validation rejects a replaced adaptation instruction', () => {
  const image = wireImage(BuiltinMap.get('Math.Sign#1:Int64'), 'int', '-4');
  const emitted = emitAssemblyDetailed(image), bytes = emitted.bytes.slice(), pe = readPE(bytes);
  const body = pe.methodBody(emitted.debug.methods[0].token), [start, length] = emitted.debug.methods[0].spans[1];
  const span = decodeInstructions(body.code).filter(instruction => instruction.offset >= start && instruction.offset < start + length);
  assert.deepEqual(span.slice(-2).map(instruction => instruction.name), ['call', 'nop']);
  const conversion = span.find(instruction => instruction.name === 'conv.i8');
  assert(conversion, 'fixture requires declared Int64 widening inside the unary builtin span');
  bytes[body.fileOffset + body.headerSize + conversion.offset] = 0;
  assert.throws(() => loadAssembly(bytes), /canonical/);
});

test('source Sign rejects false overloads, names and result conversions', () => {
  for (const body of ['Math.Sign();', 'Math.Sign(1, 2);', 'Math.Sign(d: 1.0);', 'Math.Sign(null);',
    'bool result = Math.Sign(1f);', 'System.Decimal.Sign(1);']) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
  }
});
