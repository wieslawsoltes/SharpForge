import {CilError} from './binary.js';

/** Resolve the existing host selection contract without changing method identity or overload rules. */
export function selectMethod(inspector, selection, args) {
  if (selection === undefined || selection === null) {
    if (!inspector.pe.entryPoint) {
      throw new CilError('This DLL has no entry point. Select a static method to invoke.');
    }
    return inspector.pe.entryPoint;
  }
  if (typeof selection === 'number') return selection;
  if (/^0x[0-9a-f]+$/i.test(selection)) return Number(selection);
  const matches = [...inspector.methods.values()].filter(method =>
    (method.owner + '::' + method.name === selection || method.owner + '.' + method.name === selection || method.name === selection) &&
    (args === undefined || inspector.signature(method.token).parameters.length === args.length));
  if (matches.length !== 1) {
    throw new CilError(matches.length ? 'Ambiguous method; use its MethodDef token' : 'Selected method not found');
  }
  return matches[0].token;
}
