import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {decodeInstructions, emitAssemblyDetailed, intrinsicDefinition, loadAssembly, readPE} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeMathBuiltin} from '../packages/cil/src/math-builtin-mapping.js';

const widths = [['int', 'Int32'], ['uint', 'UInt32'], ['long', 'Int64'], ['ulong', 'UInt64']];

function artifact(body, members = '') {
  const result = compileToIL(`using System; using M = System.Math;
    class P { static void Main() { ${body} } ${members} }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function assertOutput(compiled, expected) {
  const engines = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  for (const [name, create] of engines) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${name}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, name);
  }
}

function builtinIds(image) {
  return image.methods.flatMap(method => {
    const ids = [];
    for (let index = 0; index < method.code.length; index += 3) {
      if (method.code[index] === Op.BUILTIN) ids.push(method.code[index + 1]);
    }
    return ids;
  });
}

function wireImage(builtin, constants = [-4, 3]) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants, sources: [], types: [], statics: [], sequencePoints: [],
    methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main', isStatic: true, parameters: [],
      returnType: 'void', locals: [], handlers: [], code: Int32Array.from([
        Op.CONST, 0, typeof constants[0] === 'number' && !Number.isInteger(constants[0]) ? 1 : 0,
        Op.CONST, 1, typeof constants[1] === 'number' && !Number.isInteger(constants[1]) ? 1 : 0,
        Op.BUILTIN, builtin.id, 2, Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0
      ])}]};
}

test('eight integral entries append exact runtime descriptors without retyping the released wires', () => {
  let expectedId = BuiltinMap.get('Math.Sign#1:Decimal').id + 1;
  for (const [type, suffix] of widths) {
    for (const name of ['Min', 'Max']) {
      const entry = BuiltinMap.get(`Math.${name}#2:${suffix}`);
      assert.equal(entry.id, expectedId++);
      assert.equal(entry.result, type);
      assert.deepEqual(entry.params, [type, type]);
      assert.deepEqual(entry.parameterNames, ['val1', 'val2']);
      assert.equal(entry.math.owner, 'System.Math');
      assert.equal(entry.math.name, name);
      assert(intrinsicDefinition(entry.math));
      assert(Object.isFrozen(entry.math.signature.parameters));
      assert(Object.isFrozen(entry.math.signature));
      assert(Object.isFrozen(entry.math));
    }
  }
  for (const [name, id] of [['Min', 3], ['Max', 4]]) {
    const entry = BuiltinMap.get('Math.' + name);
    assert.equal(entry.id, id);
    assert.equal(entry.result, 'numeric');
    assert.deepEqual(entry.params, ['number', 'number']);
    assert.equal(entry.math, undefined);
  }
});

for (const [type, suffix] of widths) {
  test(`source ${suffix} extrema preserve full-width values, declared results, arrays and boxing`, () => {
    const minimum = type === 'int' ? '-2147483648' : type === 'long' ? '-9223372036854775808' : '0';
    const maximum = {int: '2147483647', uint: '4294967295', long: '9223372036854775807', ulong: '18446744073709551615'}[type];
    const compiled = artifact(`${type} lower = ${type}.MinValue; ${type} upper = ${type}.MaxValue;
      ${type} minimum = M.Min(val1: lower, val2: upper);
      ${type} maximum = Math.Max(val2: lower, val1: upper);
      ${type}[] values = new ${type}[] { minimum, maximum };
      Console.WriteLine(values[0]); Console.WriteLine(values[1]);
      object boxed = maximum; Console.WriteLine(boxed); Console.WriteLine(boxed.GetType().FullName);
      Console.WriteLine(Math.Min(val1: upper, val2: upper));
      Console.WriteLine(Math.Max(val1: lower, val2: lower));`);
    assertOutput(compiled, `${minimum}\n${maximum}\n${maximum}\nSystem.${suffix}\n${maximum}\n${minimum}\n`);
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
      const ids = builtinIds(image);
      assert(ids.includes(BuiltinMap.get(`Math.Min#2:${suffix}`).id));
      assert(ids.includes(BuiltinMap.get(`Math.Max#2:${suffix}`).id));
    }
  });
}

test('integral overloads preserve named-argument evaluation order and mixed numeric admission', () => {
  const compiled = artifact(`Console.WriteLine(Math.Max(val2: Read(1), val1: Read(2)));
    int signed = -1; uint unsigned = uint.MaxValue; long wide = long.MaxValue; ulong widest = ulong.MaxValue;
    long combined = Math.Min(signed, unsigned); Console.WriteLine(combined);
    Console.WriteLine(Math.Max(unsigned, wide));
    Console.WriteLine(Math.Min(wide, widest) == (double)wide);
    Console.WriteLine(Math.Max(signed, widest) == (double)widest);`,
  'static uint Read(int id) { Console.Write(id); return id == 1 ? 0u : uint.MaxValue; }');
  assertOutput(compiled, '124294967295\n-1\n9223372036854775807\nTrue\nTrue\n');
});

test('legacy floating and mixed Double calls unwrap scalar carriers without changing their wire IDs', () => {
  const compiled = artifact(`float left = 1.5f; double right = 2.25;
    Console.WriteLine(Math.Min(left, right)); Console.WriteLine(Math.Max(2L, 3.5));
    Console.WriteLine(Math.Max(left, 0.5f));`);
  assertOutput(compiled, '1.5\n3.5\n1.5\n');
  for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
    const ids = builtinIds(image);
    assert(ids.includes(3));
    assert(ids.includes(4));
  }
});

test('released int and double wire calls reload unchanged alongside marked typed calls', () => {
  for (const name of ['Min', 'Max']) {
    for (const constants of [[-4, 3], [-4.5, 3.25]]) {
      const entry = BuiltinMap.get('Math.' + name), image = wireImage(entry, constants);
      const emitted = emitAssemblyDetailed(image), decoded = loadAssembly(emitted.bytes);
      assert.equal(decoded.methods[0].code[7], entry.id);
      assertOutput({image, assembly: emitted.bytes}, String(name === 'Min' ? constants[0] : constants[1]) + '\n');
    }
    const entry = BuiltinMap.get(`Math.${name}#2:Int32`), image = wireImage(entry);
    const emitted = emitAssemblyDetailed(image), decoded = loadAssembly(emitted.bytes);
    assert.equal(decoded.methods[0].code[7], entry.id);
    assertOutput({image, assembly: emitted.bytes}, (name === 'Min' ? '-4' : '3') + '\n');
  }
});

test('typed decoder requires exact owner, signature and a single terminal call+nop', () => {
  const target = {owner: 'System.Math', name: 'Min', token: 0x0a000001,
    sig: {kind: 'method', isStatic: true, returnType: 'uint', parameters: ['uint', 'uint']}};
  const call = {name: 'call', operand: target.token}, marker = {name: 'nop'};
  assert.equal(decodeMathBuiltin(target, [call, marker]), BuiltinMap.get('Math.Min#2:UInt32'));
  for (const span of [[call], [marker, call], [call, marker, marker], [{...call, name: 'callvirt'}, marker],
    [{...call, operand: 0x0a000002}, marker], [call, call, marker]]) assert.equal(decodeMathBuiltin(target, span), null);
  for (const owner of ['Other.Math', 'System.MathF', 'System.Decimal']) {
    assert.equal(decodeMathBuiltin({...target, owner}, [call, marker]), null);
  }
  for (const replacement of [{returnType: 'int'}, {parameters: ['uint', 'int']}, {parameters: ['uint&', 'uint']},
    {parameters: ['uint']}, {isStatic: false}, {genericArity: 1}, {callingConvention: 5}, {explicitThis: true}, {sentinel: 1}]) {
    assert.equal(decodeMathBuiltin({...target, sig: {...target.sig, ...replacement}}, [call, marker]), null);
  }
});

test('full canonical validation rejects an extra nop in typed-call adaptation scaffolding', () => {
  const image = wireImage(BuiltinMap.get('Math.Min#2:Int64'));
  const emitted = emitAssemblyDetailed(image), bytes = emitted.bytes.slice(), pe = readPE(bytes);
  const body = pe.methodBody(emitted.debug.methods[0].token);
  const [start, length] = emitted.debug.methods[0].spans[2];
  const span = decodeInstructions(body.code).filter(instruction => instruction.offset >= start && instruction.offset < start + length);
  assert.deepEqual(span.slice(-2).map(instruction => instruction.name), ['call', 'nop']);
  const conversion = span.find(instruction => instruction.name === 'conv.i8');
  assert(conversion, 'fixture requires an integral widening in the builtin span');
  bytes[body.fileOffset + body.headerSize + conversion.offset] = 0;
  assert.throws(() => loadAssembly(bytes), /canonical/);
});

test('source rejects unavailable Decimal overloads and incompatible integral result destinations', () => {
  for (const body of ['Math.Min(1m, 2m);', 'Math.Max(1m, 2m);', 'Math.Min(val1: 1u);',
    'Math.Max(val1: 1u, val2: 2u, val3: 3u);', 'bool result = Math.Min(val1: 1u, val2: 2u);']) {
    const result = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(result.success, false, body);
  }
});
