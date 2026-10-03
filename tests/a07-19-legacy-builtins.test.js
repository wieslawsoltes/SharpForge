import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, BuiltinMap} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {hasLegacyBclBuiltin, invokeLegacyBclBuiltin, legacyBclBuiltinNames} from '@sharpforge/bcl-core';
import {managedFixture} from './managed-fixtures.js';
import {legacyBuiltinCases} from './fixtures/a07/legacy-builtins.js';

const staticStrings = new Set(['string.Concat', 'string.IsNullOrEmpty']);
const owners = {int: 'System.Int32', double: 'System.Double', Convert: 'System.Convert', string: 'System.String'};

function sourceImage(fixture) {
  const code = [];
  fixture.args.forEach((value, index) => code.push(Op.CONST, index, 0));
  code.push(Op.BUILTIN, BuiltinMap.get(fixture.name).id, fixture.args.length, Op.RET, 0, 0);
  return {
    formatVersion: FORMAT_VERSION,
    outputKind: 'exe',
    entryPoint: 0,
    constants: [...fixture.args],
    types: [],
    statics: [],
    sequencePoints: [],
    methods: [{
      id: 0,
      name: 'Main',
      qualifiedName: 'Fixture.Program.Main',
      isStatic: true,
      returnType: fixture.result,
      parameters: [],
      locals: [],
      handlers: [],
      code: Int32Array.from(code)
    }]
  };
}

function cilAssembly(fixture) {
  const [owner, name] = fixture.name.split('.');
  const isStatic = owner !== 'string' || staticStrings.has(fixture.name);
  const types = fixture.args.map((value, index) => {
    if (owner === 'Convert') return fixture.parameter;
    return owner === 'string' && index > 0 && typeof value === 'number' ? 'int' : 'string';
  });
  return managedFixture({methods: [{
    name: 'Main',
    parameters: types,
    result: fixture.result,
    body(writer, context) {
      for (let index = 0; index < types.length; index++) writer.op('ldarg', index);
      const parameters = isStatic ? types : types.slice(1);
      const member = context.member(owners[owner], name, fixture.result, parameters, isStatic);
      writer.op(isStatic ? 'call' : 'callvirt', member).op('ret');
    }
  }]});
}

function execute(fixture, engine) {
  const vm = engine === 'source'
    ? new VirtualMachine(sourceImage(fixture), {initialThreshold: 64})
    : new CilVirtualMachine(cilAssembly(fixture), {arguments: fixture.args, initialThreshold: 64});
  try {
    const result = vm.run();
    if (result.fault) return {fault: result.fault.name};
    assert.equal(result.state, 'terminated');
    return {value: engine === 'source' ? vm.value(vm.returnValue) : result.returnValue};
  } finally {
    vm.stop();
  }
}

test('A07 legacy parity fixture contains sixty distinct parse, conversion and string calls', () => {
  assert.equal(legacyBuiltinCases.length, 60);
  assert.equal(new Set(legacyBuiltinCases.map(row => JSON.stringify(row))).size, 60);
});

for (const [index, fixture] of legacyBuiltinCases.entries()) {
  test(`A07 legacy source and direct CIL ${index + 1}: ${fixture.name} ${JSON.stringify(fixture.args)}`, () => {
    const expected = fixture.fault ? {fault: fixture.expected} : {value: fixture.expected};
    const source = execute(fixture, 'source');
    const cil = execute(fixture, 'cil');
    assert.deepEqual(source, expected, 'source bytecode result');
    assert.deepEqual(cil, expected, 'independent direct CIL result');
    assert.deepEqual(source, cil);
  });
}

test('A07 Replace with a null old value reports ArgumentNullException on both engines', () => {
  // The source builtin previously threw ArgumentException; the contract path already used ArgumentNullException.
  const fixture = {name: 'string.Replace', args: ['abc', null, 'x'], result: 'string'};
  for (const engine of ['source', 'cil']) {
    assert.deepEqual(execute(fixture, engine), {fault: 'ArgumentNullException'});
  }
});

test('A07 legacy package surface keeps explicit host services and rejects unknown operations', () => {
  const host = {
    heap: {string: value => ({text: value})},
    value: value => value,
    format: value => value === null ? '' : String(value),
    runtimeTypeText: () => null,
    fault: (name, message) => Object.assign(new Error(message), {name})
  };
  assert(Object.isFrozen(legacyBclBuiltinNames));
  for (const name of legacyBclBuiltinNames) assert(hasLegacyBclBuiltin(name));
  assert.equal(hasLegacyBclBuiltin('toString'), false);
  assert.equal(hasLegacyBclBuiltin('Math.Abs'), false);
  assert.deepEqual(invokeLegacyBclBuiltin(host, 'object.ToString', [42]), {text: '42'});
  assert.throws(() => invokeLegacyBclBuiltin(host, 'toString', []), {name: 'MissingMethodException'});
  assert.throws(() => invokeLegacyBclBuiltin(host, 'Math.Abs', [-1]), {name: 'MissingMethodException'});
});
