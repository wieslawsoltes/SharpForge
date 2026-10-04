import { readExecutionSignatureAst } from '../metadata/execution-signature.js';
import { CilError } from '../binary.js';
import { primitiveStorageSlot } from './typed-storage.js';
import { ensureTypedMetadata } from './typed-metadata.js';

export { primitiveRelations, primitiveVerificationSlot } from './typed-storage.js';

/** Decode each lossless AST once; canonical primitive identities preserve address element types. */
export function typedMethodSignature(inspector, method, options, state) {
  const fail = state.fail;
  const slot = type => primitiveStorageSlot(type) ?? ensureTypedMetadata(state, inspector, options).slot(type);
  const read = token => {
    try { return readExecutionSignatureAst(inspector.metadata, token, options); }
    catch (error) {
      if (!(error instanceof CilError)) throw error;
      fail('SignatureUnavailable', error.message, true);
    }
  };
  const signature = read(method.token);
  if (signature.explicitThis || signature.genericArity || signature.callingConvention || signature.sentinel !== -1)
    fail('UnsupportedSignature', 'Explicit-this, generic and vararg typing requires later verifier policies', true);
  if (signature.hasThis === !!(method.flags & 0x10)) fail('MethodInstanceConvention');
  const localSignature = method.localSignature ? read(method.localSignature) : null;
  if (localSignature && localSignature.kind !== 'locals') fail('InvalidLocalSignature', 'Method body requires a locals signature');
  const locals = localSignature?.types ?? [];
  const returnType = signature.returnType;
  if (returnType.kind === 'byref') fail('UnsupportedSignature', 'Byref returns require lifetime verification', true);
  const parameters = signature.parameters.map(slot);
  if (signature.hasThis) parameters.unshift(ensureTypedMetadata(state, inspector, options).instanceSlot());
  return {
    arguments: parameters,
    locals: locals.map(slot),
    result: returnType.kind === 'primitive' && returnType.name === 'void' ? null : slot(returnType).value,
  };
}
