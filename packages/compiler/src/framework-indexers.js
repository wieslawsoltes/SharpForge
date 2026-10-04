import {types, frameworkType, findContracts} from '@sharpforge/framework';
import {Op} from '@sharpforge/bytecode';
import {DiagnosticId} from './diagnostics/codes.js';
import {typeText} from './type-utils.js';
import {registeredIndexerName} from './symbols/registry-indexers.js';

const frameworkRegistry = {types, frameworkType, findContracts};

/** Resolve an existing accessor; the internal resolver parameter also supports isolated compiler fixtures. */
export function registeredIndexerContract(type, access, registry = frameworkRegistry) {
  const name = registeredIndexerName(registry.frameworkType(type), registry.types);
  return registry.findContracts(type, access + '_' + name, false)[0];
}

/** Preserve legacy indexer receiver/key evaluation order and its existing assignment representation. */
export function prepareRegisteredIndexer(compiler, node, registry = frameworkRegistry) {
  const type = compiler.infer(node.target);
  const get = registeredIndexerContract(type, 'get', registry);
  const set = registeredIndexerContract(type, 'set', registry);
  if (!get && !set) return null;
  const keyType = get?.parameters[0] ?? set.parameters[0];
  const valueType = get?.result ?? set.parameters[1];
  if (!set) compiler.c.report(node, DiagnosticId.CS0200, [typeText(type) + '.this[]']);
  compiler.expr(node.target);
  const receiver = compiler.temp(type);
  compiler.emit(Op.STLOC, receiver);
  compiler.emit(Op.POP);
  compiler.checkAssign(keyType, compiler.expr(node.index), node.index);
  const key = compiler.temp(keyType);
  compiler.emit(Op.STLOC, key);
  compiler.emit(Op.POP);
  return {kind: 'framework', type: valueType, receiver, key, property: {get, set}};
}
