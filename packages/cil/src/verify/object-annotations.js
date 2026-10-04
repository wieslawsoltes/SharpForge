import { decodeCoded } from '../metadata/indices.js';
import { readExecutionSignatureAst } from '../metadata/execution-signature.js';
import { requireMemberToken } from './metadata-members/budget.js';
import { dataflowCancellation, dataflowFailure, dataflowLimit } from './dataflow.js';

const constructorTables = Object.freeze([6, 10]);

function annotationIndex(metadata, options) {
  const rows = metadata.rows[12] ?? [];
  const limit = dataflowLimit(options.maxObjectAnnotationRows, 65535, 65535);
  if (rows.length > limit) dataflowFailure('Object annotation row limit exceeded');
  const index = new Map();
  const counts = { 6: metadata.rows[6]?.length ?? 0, 10: metadata.rows[10]?.length ?? 0 };
  for (const row of rows) {
    dataflowCancellation(options.signal);
    const parent = decodeCoded('HasCustomAttribute', row[0]);
    if (parent >>> 24 !== 2) continue;
    metadata.row(parent);
    const constructor = decodeCoded('CustomAttributeType', row[1]);
    requireMemberToken(constructor, counts, constructorTables);
    let constructors = index.get(parent);
    if (!constructors) {
      constructors = [];
      index.set(parent, constructors);
    }
    constructors.push(constructor);
  }
  return index;
}

function constructorShape(metadata, options, fail) {
  const signatures = new Map();
  let remaining = dataflowLimit(options.maxObjectAnnotationBytes, 1048576, 1048576);
  return token => {
    dataflowCancellation(options.signal);
    const table = token >>> 24;
    const row = metadata.row(token);
    if (metadata.string(row[table === 6 ? 3 : 1]) !== '.ctor') fail('ObjectAnnotationMetadata', 'Attribute requires a constructor');
    if (table === 6 && ((row[2] & 0x1800) !== 0x1800 || row[2] & 0x410))
      fail('ObjectAnnotationMetadata', 'Attribute constructor requires ordinary instance constructor flags');
    const blob = row[table === 6 ? 4 : 2];
    if (signatures.has(blob)) return;
    const bytes = metadata.blob(blob);
    if (bytes.length > remaining) dataflowFailure('Object annotation signature byte limit exceeded');
    remaining -= bytes.length;
    const signature = readExecutionSignatureAst(metadata, token, { signal: options.signal, maxDepth: 32, maxNodes: 256 });
    if (signature.returnType?.kind === 'modreq' || signature.returnType?.kind === 'modopt')
      fail('ObjectAnnotationSignatureUnavailable', 'Modified attribute constructor returns require normalization', true);
    if (signature.kind !== 'method' || !signature.hasThis || signature.explicitThis || signature.genericArity ||
        signature.callingConvention || signature.sentinel !== -1 || signature.returnType.kind !== 'primitive' ||
        signature.returnType.name !== 'void') fail('ObjectAnnotationMetadata', 'Invalid attribute constructor signature');
    signatures.set(blob, true);
  };
}

function classifyConstructor(token, options, fail) {
  dataflowCancellation(options.signal);
  let result;
  try {
    const response = options.objectTypeAnnotations?.classifyConstructor?.(token);
    const synchronous = response !== null && typeof response === 'object' && typeof response.then !== 'function';
    const status = synchronous ? response.status : undefined;
    const byRefLike = status === 'known' ? response.value?.byRefLike : undefined;
    const reason = status === 'unknown' ? response.reason : undefined;
    if (status === 'known' && typeof byRefLike === 'boolean') result = { byRefLike };
    else if (status === 'unknown' && typeof reason === 'string' && reason.length > 0 && reason.length <= 256) result = { reason };
    else result = { reason: 'A synchronous known/unknown constructor annotation result is required' };
  } catch {
    result = { reason: 'Object annotation authority failed' };
  }
  dataflowCancellation(options.signal);
  if (result.reason !== undefined) fail('ObjectAnnotationAuthorityUnavailable', result.reason, true);
  return result.byRefLike;
}

/** Preparation-only, module-scoped authority. No callback, metadata view or returned provider object reaches block states. */
export function objectAnnotationReader(metadata, options, fail) {
  const index = annotationIndex(metadata, options);
  const validate = constructorShape(metadata, options, fail);
  const constructors = new Map();
  return type => {
    let byRefLike = false;
    for (const token of index.get(type.token) ?? []) {
      dataflowCancellation(options.signal);
      if (!constructors.has(token)) {
        validate(token);
        constructors.set(token, classifyConstructor(token, options, fail));
      }
      byRefLike ||= constructors.get(token);
    }
    return byRefLike;
  };
}
