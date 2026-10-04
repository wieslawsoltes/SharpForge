import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {decodeTypeSignature} from './metadata/signatures.js';
import {readExecutionSignatureAst} from './metadata/execution-signature.js';
import {sha1} from './binary/sha1.js';
import {asyncTypes, asyncValueType} from './async-profile.js';

const frameworkKeys = new Map([
  ['System.Runtime', 'b03f5f7f11d50a3a'], ['System.Threading.Tasks', 'b03f5f7f11d50a3a'],
  ['mscorlib', 'b77a5c561934e089'], ['System.Private.CoreLib', '7cec85d7bea7798e'],
  ['netstandard', 'cc7b13ffcd2ddd51']
]);
const calls = new WeakMap();

function referenceToken(metadata, token) {
  if (token >>> 24 !== 27) return token;
  const node = decodeTypeSignature(metadata.blob(metadata.row(token)[0]));
  return node.kind === 'genericInstance' ? node.type.token : node.token;
}

/** Known runtime reference identities are metadata contracts; local TypeDefs and other assemblies are never intrinsic. */
export function isAsyncFrameworkReference(inspector, input) {
  const metadata = inspector.metadata;
  let token = referenceToken(metadata, input), depth = 0;
  while (token >>> 24 === 1) {
    if (++depth > 64) throw new CilError('Async reference scope nesting limit exceeded');
    token = decodeCoded('ResolutionScope', metadata.row(token)[0]);
  }
  if (token >>> 24 !== 35) return false;
  const row = metadata.row(token), expected = frameworkKeys.get(metadata.string(row[6]));
  if (!expected || metadata.string(row[7]) || row[4] & ~0x101) return false;
  const key = metadata.blob(row[5]);
  if (key.length > 16_384 || (row[4] & 1 ? key.length < 16 : key.length !== 8)) return false;
  const bytes = row[4] & 1 ? sha1(key).slice(-8).reverse() : key;
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') === expected;
}

function checkSignatureTypes(inspector, signature) {
  const pending = [signature.returnType, ...signature.parameters];
  let remaining = 65_536;
  while (pending.length) {
    const type = pending.pop();
    if (--remaining < 0) throw new CilError('Async signature type budget exceeded');
    if (type.element) pending.push(type.element);
    if (type.kind === 'genericInstance') pending.push(type.type, ...type.arguments);
    if (!['class', 'valuetype'].includes(type.kind)) continue;
    const name = inspector.metadata.typeName(type.token), value = asyncValueType(name);
    const known = value || Object.values(asyncTypes).includes(name) ||
      name === asyncTypes.task + '`1' || name === 'System.Exception' || name === 'System.Action';
    if (!known) continue;
    if (!isAsyncFrameworkReference(inspector, type.token) || type.kind !== (value ? 'valuetype' : 'class')) {
      throw new CilError('Async ABI signature uses an incompatible runtime type identity');
    }
  }
}

export function verifyAsyncSignatureTypes(inspector, token) {
  checkSignatureTypes(inspector, readExecutionSignatureAst(inspector.metadata, token));
}

/** Verify the lossless MemberRef signature and TypeRef/TypeSpec scope once per resolved call descriptor. */
export function verifyAsyncReferenceCall(inspector, descriptor) {
  let verified = calls.get(inspector);
  if (!verified) calls.set(inspector, verified = new WeakSet());
  if (verified.has(descriptor)) return;
  if (descriptor.resolvedToken || !isAsyncFrameworkReference(inspector, descriptor.ownerToken)) {
    throw new CilError('Async ABI member must reference a supported runtime assembly identity');
  }
  const token = descriptor.definitionToken ?? descriptor.token;
  if (token >>> 24 !== 10) throw new CilError('Async ABI call requires a runtime MemberRef');
  verifyAsyncSignatureTypes(inspector, token);
  verified.add(descriptor);
}
