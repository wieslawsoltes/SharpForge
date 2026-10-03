import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {contracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

let emptyProgram;

/** Exercise the real framework dispatch and managed heap without timing interpreter loops. */
export function createClosedCollection(engine, family, argumentsText) {
  emptyProgram ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(emptyProgram.success, true, JSON.stringify(emptyProgram.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(emptyProgram.image) : new CilVirtualMachine(emptyProgram.assembly);
  const owner = `System.Collections.Generic.${family}\`${family === 'Dictionary' ? 2 : 1}<${argumentsText}>`;
  const members = contracts.filter(member => member.owner === owner);
  const constructor = members.find(member => member.kind === 'constructor' && member.parameters.length === 0);
  assert(constructor, 'Missing collection constructor: ' + owner);
  const platform = vm.platform;
  const reference = platform.invoke(constructor, []);
  const call = (name, ...args) => {
    const descriptor = members.find(member => member.name === name && member.parameters.length === args.length);
    assert(descriptor, 'Missing collection member: ' + name);
    return platform.invoke(descriptor, [reference, ...args]);
  };
  return {vm, platform, reference, call};
}
