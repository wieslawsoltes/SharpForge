import {lookupMembers} from '../../binder/inheritance.js';
import {Accessibility, SymbolKind} from '../../symbols/types.js';

function callableContract(method) {
  return method.kind === SymbolKind.Method && method.declaredAccessibility === Accessibility.Public &&
    !method.isStatic && !method.arity && !method.parameters.length && method.returnsVoid &&
    method.contract?.kind === 'method';
}

/** Preserve declared source disposal; resolve inherited calls only for registered parameterless void contracts. */
export function disposeMethod(type, core, registry) {
  const declared = type.getMembers('Dispose').find(method => method.kind === SymbolKind.Method && !method.parameters.length);
  if (declared) return declared;
  if (!registry.registryName(type)) return null;
  return lookupMembers(type, 'Dispose', core).members.find(callableContract) ?? null;
}
