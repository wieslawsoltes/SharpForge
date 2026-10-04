import {registryMethod} from './registry-signatures.js';

export {registryParameter} from './registry-params.js';

/** Create and index the method symbol for one immutable ABI contract. */
export function registryContractMethod(bridge, contract, kind, common) {
  const method = registryMethod(bridge, contract, common.containingSymbol, kind, common);
  method.contract = contract;
  bridge.contractSymbols.set(contract.id, method);
  return method;
}
