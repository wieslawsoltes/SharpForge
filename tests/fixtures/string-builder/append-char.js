import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';

export const builderType = 'System.Text.StringBuilder';
export const units = value => value.split('').map(unit => unit.charCodeAt(0));
export const appendParameters = row => row.repeatCount === null ? ['char'] : ['char', 'int'];
export const appendArguments = row => row.repeatCount === null ? [row.value] : [row.value, row.repeatCount];

export function builderContract(name, parameters = []) {
  const descriptor = findContracts(builderType, name).find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing StringBuilder.${name}(${parameters.join(',')})`);
  return descriptor;
}

let program;
export function builderPlatform(engine, initial = 'seed|') {
  program ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const reference = platform.invoke(builderContract('.ctor', ['string']), [platform.heap.string(initial)]);
  const call = (name, parameters = [], values = []) => platform.invoke(builderContract(name, parameters), [reference, ...values]);
  return {vm, platform, reference, call, stop: () => vm.stop()};
}

/** Call exact character signatures in ordinary CIL without the source compiler or emitted profile. */
export function appendCharacterAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 3, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(String.fromCharCode(...row.initial)))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', field).op('ldsfld', field).op('ldc.i4', row.value).op('conv.u2');
      if (row.repeatCount !== null) writer.op('ldc.i4', row.repeatCount);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, appendParameters(row), false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
