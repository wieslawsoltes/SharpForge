import {CilError} from './binary.js';
import {readExecutionSignatureAst} from './metadata/execution-signature.js';
import {formatSignature} from './metadata/signature-format.js';

function unsupported(signature, message) {
  return Object.assign(new CilError(message), {code: signature.callingConvention ? 'IL_UNMANAGED' : 'IL_CALLI',
    exceptionType: 'NotSupportedException', callingConvention: signature.callingConvention ?? 0});
}

/** Inspect the lossless AST before using historical display types, which omit fnptr flags. */
function validatePointers(node) {
  if (!node || typeof node !== 'object') return;
  if (node.kind === 'functionPointer') {
    const signature = node.signature;
    if (signature.callingConvention || signature.hasThis || signature.genericArity || signature.sentinel >= 0) {
      throw unsupported(signature, 'Only managed static nongeneric function-pointer signatures are executable');
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(validatePointers);
    else if (value && typeof value === 'object') validatePointers(value);
  }
}

/** Execution-only projection; never changes the public inspection formatter or decoded metadata. */
export function functionPointerExecutionSignature(inspector, token) {
  const metadata = inspector.metadata;
  const signature = readExecutionSignatureAst(metadata, token);
  if (token >>> 24 === 17 && signature.kind === 'method' && signature.explicitThis) {
    throw unsupported(signature, 'ExplicitThis calli signatures are not implemented');
  }
  validatePointers(signature);
  return formatSignature(signature, metadata);
}

export function requireManagedCalli(signature) {
  if (signature.kind !== 'method') throw new CilError('calli requires a managed StandAloneSig');
  if (signature.callingConvention || signature.genericArity || signature.sentinel !== undefined) {
    throw unsupported(signature, 'calli supports only default managed nongeneric signatures');
  }
}
