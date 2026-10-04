import {fixedCallSignature, validVarargsSignature} from './varargs-profile.js';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {genericTypeParts, substituteCallType, instantiateSignature, callSignatureKey} from './generic-signatures.js';
export {normalizeCallType, substituteCallType, instantiateSignature, callSignatureKey} from './generic-signatures.js';

/** GenericParam rows in ordinal order for either a MethodDef or TypeDef owner. */
export function methodGenericParameters(inspector, owner) {
  return (inspector.metadata.rows[42] ?? []).map((row, index) => ({
    index: row[0], flags: row[1], owner: decodeCoded('TypeOrMethodDef', row[2]), row: index + 1
  })).filter(parameter => parameter.owner === owner).sort((a, b) => a.index - b.index);
}

/** Resolve MemberRef/MethodSpec within the caller's declaring-type and method contexts.
 * A supplied raw descriptor must be the immutable, unsubstituted token-cache entry.
 */
export function resolveExecutionMethod(inspector, token, context = {}, raw = inspector.resolveToken(token)) {
  if (raw.kind !== 'method') throw new CilError('Call operand is not a method');
  const contextTypes = context.typeArguments ?? genericTypeParts(context.genericIdentity ?? '').arguments;
  const contextMethods = context.methodArguments ?? [];
  const methodArguments = (raw.genericArguments ?? []).map(type => substituteCallType(type, contextTypes, contextMethods));
  const arity = raw.signature.genericArity ?? 0;
  if (raw.genericArguments && methodArguments.length !== arity) throw new CilError('Generic method argument count mismatch');
  let owner = substituteCallType(raw.owner, contextTypes, contextMethods);
  let parts = genericTypeParts(owner);
  const varargOwner = raw.signature.callingConvention === 5 && raw.ownerToken >>> 24 === 6 ? raw.ownerToken : null;
  let target = varargOwner ?? raw.resolvedToken ?? (raw.token >>> 24 === 6 ? raw.token :
    raw.definitionToken >>> 24 === 6 ? raw.definitionToken : null);
  let definition = target ? inspector.methods.get(target) : null;
  if (definition?.ownerToken === context.ownerToken && context.genericIdentity && !parts.arguments.length) {
    owner = context.genericIdentity;
    parts = genericTypeParts(owner);
  }
  const signature = instantiateSignature(raw.signature, parts.arguments.length ? parts.arguments : contextTypes, methodArguments);
  if (!definition) {
    const visited = new Set();
    while (!visited.has(owner)) {
      if (visited.size >= 64) throw new CilError('Call declaring-type nesting limit exceeded');
      visited.add(owner);
      const type = inspector.types.find(type => type.name === parts.definition);
      if (!type) break;
      const matches = type.methods.filter(method => method.name === raw.name &&
        callSignatureKey(instantiateSignature(inspector.signature(method.token), parts.arguments, methodArguments)) ===
          callSignatureKey(fixedCallSignature(signature)));
      if (matches.length > 1) throw new CilError('Ambiguous internal call declaration');
      if (matches.length) {
        definition = matches[0];
        target = definition.token;
        break;
      }
      if (!type.baseToken) break;
      owner = substituteCallType(inspector.metadata.typeName(type.baseToken), parts.arguments);
      parts = genericTypeParts(owner);
    }
  }
  if (target && signature.callingConvention === 5 && !validVarargsSignature(inspector.signature(target), signature, callSignatureKey)) {
    throw new CilError('Vararg fixed signature mismatch: call site does not match the declaration');
  }
  return {...raw, ...(definition ?? {}), token: raw.token, resolvedToken: target,
    definitionToken: target ?? raw.definitionToken, signature,
    owner: definition?.owner ?? raw.owner, ownerInstance: parts.arguments.length ? owner : null,
    typeArguments: parts.arguments, methodArguments,
    genericArguments: raw.genericArguments ? methodArguments : undefined};
}
