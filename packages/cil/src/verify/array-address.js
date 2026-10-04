import { CilError, equalBytes } from '../binary.js';
import { decodeCoded } from '../metadata/indices.js';
import { decodeSignature, decodeTypeSignature } from '../metadata/signatures.js';
import { encodeTypeSignature } from '../metadata/signature-writer.js';

function limit(message) {
  const error = new CilError(message);
  error.code = 'CILPC0007';
  throw error;
}

// Read only the fixed ASCII name, without decoding or scanning an untrusted heap string.
function isAddressName(metadata, index) {
  const heap = metadata.streams?.get('#Strings');
  if (!heap || !Number.isInteger(index) || index < 0 || index > heap.length - 8) return false;
  return heap[index] === 65 && heap[index + 1] === 100 && heap[index + 2] === 100 &&
    heap[index + 3] === 114 && heap[index + 4] === 101 && heap[index + 5] === 115 &&
    heap[index + 6] === 115 && heap[index + 7] === 0;
}

/** Invocation-local recognition of exact array Address metadata, without resolved type identities. */
export class ArrayAddressMetadata {
  #metadata;
  #options;
  #members = new Set();
  #arrays = new Map();
  #bytes = 0;

  constructor(metadata, signal) {
    this.#metadata = metadata;
    this.#options = { maxDepth: 32, maxNodes: 256, signal };
  }

  #blob(index) {
    const bytes = this.#metadata.blob(index);
    if (!(bytes instanceof Uint8Array)) throw new CilError('Invalid array Address signature bytes');
    if (bytes.length > 4096 || (this.#bytes += bytes.length) > 1024 * 1024)
      limit('Array Address signature byte limit exceeded');
    return bytes;
  }

  #array(token) {
    if (this.#arrays.has(token)) return this.#arrays.get(token);
    if (this.#arrays.size >= 1024) limit('Array Address type count limit exceeded');
    const type = decodeTypeSignature(this.#blob(this.#metadata.row(token)[0]), this.#options);
    if (type.kind !== 'array' && type.kind !== 'szarray') return null;
    const array = { rank: type.kind === 'szarray' ? 1 : type.rank,
      element: encodeTypeSignature(type.element, this.#options) };
    this.#arrays.set(token, array);
    return array;
  }

  matches(token) {
    if (this.#members.has(token)) return true;
    if (this.#members.size >= 1024) limit('Array Address member count limit exceeded');
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff ||
        token >>> 24 !== 10 || !(token & 0xffffff) || typeof this.#metadata.blob !== 'function') return false;
    const row = this.#metadata.row(token);
    if (!isAddressName(this.#metadata, row[1])) return false;
    const parent = decodeCoded('MemberRefParent', row[0]);
    if (parent >>> 24 !== 27 || !(parent & 0xffffff)) return false;
    const array = this.#array(parent);
    if (!array) return false;
    const method = decodeSignature(this.#blob(row[2]), this.#options);
    if (method.kind !== 'method' || !method.hasThis || method.explicitThis || method.callingConvention !== 0 ||
        method.genericArity || method.sentinel !== -1 || method.parameters.length !== array.rank ||
        method.returnType.kind !== 'byref') return false;
    for (const parameter of method.parameters)
      if (parameter.kind !== 'primitive' || parameter.name !== 'int') return false;
    if (!equalBytes(array.element, encodeTypeSignature(method.returnType.element, this.#options))) return false;
    this.#members.add(token);
    return true;
  }
}
