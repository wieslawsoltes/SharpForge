import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';

export function compilePropertyFixture(source) {
  const built = compileToIL(source);
  assert.equal(built.success, true, built.diagnostics.map(value => value.code + ': ' + value.message).join('\n'));
  return built;
}

export function* propertyEngines(built) {
  const options = {initialThreshold: 64, bindingAssembly: built.assembly};
  yield ['source', new VirtualMachine(built.image, options)];
  yield ['canonical', new VirtualMachine(loadAssembly(built.assembly), options)];
  yield ['cil', new CilVirtualMachine(built.assembly, {initialThreshold: 64})];
  yield ['reassembled', new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes, {initialThreshold: 64})];
}

export function rootedPropertySource(vm, name = 'source') {
  const result = vm.run();
  assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
  const node = vm.platform.scene().nodes.find(candidate => candidate.properties.Name === name);
  assert(node, 'The source fixture stays rooted through its active Window');
  return vm.platform.ui.reference(node.id);
}
