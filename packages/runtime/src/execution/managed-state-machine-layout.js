import {verifiedMethod} from './token-cache.js';

const interfaceName = 'System.Runtime.CompilerServices.IAsyncStateMachine';
const declarations = ['MoveNext', 'SetStateMachine'].map(name => Object.freeze({
  kind: 'method', owner: interfaceName, name,
  signature: Object.freeze({isStatic: false, returnType: 'void',
    parameters: Object.freeze(name === 'MoveNext' ? [] : [interfaceName])})
}));

/** The existing verified async interface admits managed fields, never an ABI byte layout. */
export function hasManagedStateMachineLayout(vm, table) {
  const definition = vm.typeSystem?.types.get(table.definitionToken);
  if (!vm.inspector || !definition || !table.flags.valueType || table.containsGenericParameters ||
      table.flags.refStruct || table.flags.nullable || (definition.flags & 0x18) !== 0) return false;
  const contract = vm.typeSystem.table(interfaceName);
  if (!contract.flags.interface || vm.typeSystem.types.has(contract.definitionToken) || !table.interfaceMap.has(contract)) return false;
  return declarations.every(declaration => {
    const target = vm.typeSystem.dispatch.externalTarget(table.name, declaration);
    return !!target && vm.inspector.methods.get(target)?.hasBody && verifiedMethod(vm, target);
  });
}
