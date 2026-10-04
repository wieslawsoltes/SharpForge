import {CilError} from './binary.js';
import {decodeSignature} from './metadata/signatures.js';
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
  const metadata = inspector.metadata, row = metadata.row(token), table = token >>> 24;
  const column = table === 6 ? 4 : table === 4 || table === 10 ? 2 : table === 43 ? 1 : 0;
  if (![4, 6, 10, 17, 43].includes(table)) throw new CilError('Token has no executable member signature');
  const signature = decodeSignature(metadata.blob(row[column]));
  validatePointers(signature);
  return formatSignature(signature, metadata);
}

export function requireStaticCalli(signature) {
  if (signature.kind !== 'method') throw new CilError('calli requires a managed StandAloneSig');
  if (signature.callingConvention || !signature.isStatic || signature.genericArity || signature.sentinel !== undefined) {
    throw unsupported(signature, 'calli supports only managed static nongeneric signatures');
  }
}
