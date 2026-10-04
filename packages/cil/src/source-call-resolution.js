import {CilError} from './binary.js';
import {decodeCoded, readSignature} from './metadata.js';

/** Source-image calls use definition, member-reference, or verified generic MethodSpec identities. */
export function resolveSourceCall(metadata, typeOwners, methodToken, depth = 0) {
  if (depth > 8) throw new CilError('MethodSpec resolution nesting exceeded');
  const row = metadata.row(methodToken), table = methodToken >>> 24;
  if (table === 43) {
    const method = resolveSourceCall(metadata, typeOwners, decodeCoded('MethodDefOrRef', row[0]), depth + 1);
    const spec = readSignature(metadata.blob(row[1]), metadata);
    if (spec.kind !== 'methodSpec' || spec.arguments.length !== method.sig.genericArity)
      throw new CilError('Invalid source MethodSpec signature');
    return {...method, token: methodToken, methodToken: method.token, methodArguments: spec.arguments};
  }
  if (table === 6) return {token: methodToken, owner: metadata.typeName(typeOwners.get(methodToken)),
    name: metadata.string(row[3]), sig: readSignature(metadata.blob(row[4]), metadata)};
  if (table !== 10) throw new CilError('Unsupported method token');
  const parent = decodeCoded('MemberRefParent', row[0]);
  return {token: methodToken, owner: metadata.typeName(parent >>> 24 === 6 ? typeOwners.get(parent) : parent), name: metadata.string(row[1]),
    sig: readSignature(metadata.blob(row[2]), metadata), ...(parent >>> 24 === 6 ? {methodToken: parent} : {})};
}
