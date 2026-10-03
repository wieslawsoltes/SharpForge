import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, BuiltinMap} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';

const staticStrings = new Set(['string.Concat', 'string.IsNullOrEmpty']);
const owners = {int: 'System.Int32', double: 'System.Double', Convert: 'System.Convert', string: 'System.String'};

export function sourceImage(fixture) {
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

export function cilAssembly(fixture) {
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
      const parameters = fixture.cilParameters ?? (isStatic ? types : types.slice(1));
      const member = context.member(owners[owner], name, fixture.result, parameters, isStatic);
      writer.op(isStatic ? 'call' : 'callvirt', member).op('ret');
    }
  }]});
}

export function execute(fixture, engine) {
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

