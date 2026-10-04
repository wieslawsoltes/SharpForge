import {loadedVirtualFlags} from '../emit/method-flags.js';

/** Reconstruct executable method identity from CLI metadata, with debug names and source spans. */
export function loadedImageMethod(info, {id, owner, signature, flags, parameters, locals, disposable}) {
  const implementsDispose = disposable && info.name === 'Dispose' && parameters.length === 0 &&
    !signature.isStatic && flags === 0x1e6;
  return {
    ...(info.asyncRole ? {asyncRole: info.asyncRole, asyncOrigin: info.asyncOrigin} : {}),
    ...(info.sourceRange ? {sourceRange: info.sourceRange} : {}),
    ...(info.accessor ? {accessor: info.accessor} : {}),
    id, name: info.name, qualifiedName: info.qualifiedName, owner,
    isStatic: signature.isStatic, returnType: signature.returnType,
    ...(implementsDispose ? {implementsDispose: true} : loadedVirtualFlags(flags)),
    parameters, locals, code: null, handlers: []
  };
}
