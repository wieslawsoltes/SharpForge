import {MethodSymbol, DeclarationModifiers} from './members.js';
import {contractParameters} from './registry-params.js';

export {registryParameter} from './registry-params.js';

/** Create and index the method symbol for one immutable ABI contract. */
export function registryContractMethod(bridge, contract, kind, common) {
  const method = new MethodSymbol({
    ...common,
    name: contract.name,
    methodKind: kind,
    returnType: contract.kind === 'constructor' ? bridge.byName.get('void')
      : bridge.typeFromName(contract.result) ?? bridge.objectType,
    parameters: contractParameters(bridge, contract),
    modifiers: contract.isStatic ? DeclarationModifiers.Static : 0
  });
  method.contract = contract;
  bridge.contractSymbols.set(contract.id, method);
  return method;
}
