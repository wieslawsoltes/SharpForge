import { Writer, CilError } from '../binary.js';
import { codedIndex } from './indices.js';
import {
  signaturePrimitives, signatureBudget, signatureCount, checkSignatureType, checkMethodHeader,
} from './signature-types.js';

/** Signed compressed integers retain their chosen width when the rotated value is small. */
export function writeSignedCompressed(writer, value) {
  if (!Number.isInteger(value) || value < -0x10000000 || value > 0x0fffffff) {
    throw new CilError('Invalid signed compressed integer');
  }
  const bits = value >= -64 && value <= 63 ? 7 : value >= -8192 && value <= 8191 ? 14 : 29;
  const encoded = ((value & (2 ** (bits - 1) - 1)) * 2) + (value < 0 ? 1 : 0);
  if (bits === 7) writer.u8(encoded);
  else if (bits === 14) writer.u8(0x80 | (encoded >>> 8)).u8(encoded);
  else writer.u8(0xc0 | (encoded >>> 24)).u8(encoded >>> 16).u8(encoded >>> 8).u8(encoded);
  return writer;
}

const typeWriters = {
  primitive(node) { this.writer.u8(signaturePrimitives[node.name]); },
  class(node) { this.writer.u8(0x12); this.reference(node.token); },
  valuetype(node) { this.writer.u8(0x11); this.reference(node.token); },
  pointer(node, depth) { this.writer.u8(0x0f); this.type(node.element, depth + 1, 'pointer'); },
  byref(node, depth) { this.writer.u8(0x10); this.type(node.element, depth + 1); },
  szarray(node, depth) { this.writer.u8(0x1d); this.type(node.element, depth + 1); },
  pinned(node, depth) { this.writer.u8(0x45); this.type(node.element, depth + 1, 'localUnpinned'); },
  modreq(node, depth, context) { this.writer.u8(0x1f); this.reference(node.token); this.type(node.element, depth + 1, context); },
  modopt(node, depth, context) { this.writer.u8(0x20); this.reference(node.token); this.type(node.element, depth + 1, context); },
  genericParameter(node) {
    if (!['type', 'method'].includes(node.scope)) throw new CilError('Invalid generic parameter scope');
    this.writer.u8(node.scope === 'type' ? 0x13 : 0x1e).compressed(signatureCount(node.index, 'Generic parameter index'));
  },
  genericInstance(node, depth) {
    if (!['class', 'valuetype'].includes(node.type?.kind)) throw new CilError('Generic instance requires a class or valuetype');
    if (!node.arguments?.length) throw new CilError('Generic instance requires arguments');
    this.writer.u8(0x15);
    this.type(node.type, depth + 1);
    this.values(node.arguments, 'Generic arguments');
    for (const argument of node.arguments) this.type(argument, depth + 1);
  },
  array(node, depth) {
    const rank = signatureCount(node.rank, 'Array rank', 32);
    if (!rank) throw new CilError('Array rank must be positive');
    if (!Array.isArray(node.sizes) || !Array.isArray(node.lowerBounds) ||
        node.sizes.length > rank || node.lowerBounds.length > rank) throw new CilError('Invalid array shape');
    this.writer.u8(0x14);
    this.type(node.element, depth + 1);
    this.writer.compressed(rank);
    this.values(node.sizes, 'Array sizes');
    for (const size of node.sizes) this.writer.compressed(size);
    this.values(node.lowerBounds, 'Array bounds');
    for (const bound of node.lowerBounds) writeSignedCompressed(this.writer, bound);
  },
  functionPointer(node, depth) {
    if (node.signature?.kind !== 'method') throw new CilError('Function pointer requires a method signature');
    this.writer.u8(0x1b);
    this.method(node.signature, depth + 1);
  },
};

class SignatureEncoder {
  constructor(writer, options) {
    this.writer = writer;
    this.budget = signatureBudget(options);
  }
  reference(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || !(value & 0xffffff)) {
      throw new CilError('Invalid signature type token');
    }
    this.writer.compressed(codedIndex('TypeDefOrRef', value));
  }
  values(items, label) {
    if (!Array.isArray(items)) throw new CilError(`Invalid ${label}`);
    this.writer.compressed(signatureCount(items.length, label));
  }

  type(node, depth = 0, context = 'type') {
    this.budget(depth);
    checkSignatureType(node, context);
    if (!Object.hasOwn(typeWriters, node.kind)) throw new CilError('Unknown signature type kind');
    typeWriters[node.kind].call(this, node, depth, context);
  }
  method(node, depth = 0) {
    this.budget(depth);
    if (!Array.isArray(node.parameters)) throw new CilError('Invalid signature parameters');
    const property = node.kind === 'property';
    this.writer.u8(property ? 8 | (node.hasThis ? 0x20 : 0) : checkMethodHeader(node));
    if (!property && node.genericArity) this.writer.compressed(node.genericArity);
    this.values(node.parameters, 'Parameters');
    this.type(node.returnType, depth + 1, property ? 'property' : 'return');
    node.parameters.forEach((parameter, index) => {
      if (!property && node.sentinel === index) this.writer.u8(0x41);
      this.type(parameter, depth + 1, 'parameter');
    });
  }
  signature(node) {
    if (!node || typeof node !== 'object') throw new CilError('Invalid signature');
    if (node.kind === 'field') {
      this.writer.u8(6);
      this.type(node.type, 0, 'field');
    } else if (node.kind === 'locals' || node.kind === 'methodSpec') {
      const locals = node.kind === 'locals';
      const items = locals ? node.types : node.arguments;
      if (!locals && !items?.length) throw new CilError('MethodSpec requires arguments');
      this.writer.u8(locals ? 7 : 10);
      this.values(items, 'Signature types');
      for (const item of items) this.type(item, 0, locals ? 'local' : 'type');
    } else if (node.kind === 'method' || node.kind === 'property') this.method(node);
    else throw new CilError('Unknown signature kind');
  }
}

/** Encode an AST signature with ECMA-335 context checks and bounded traversal. */
export function encodeSignature(signature, options = {}) {
  const writer = new Writer();
  new SignatureEncoder(writer, options).signature(signature);
  return writer.finish();
}

/** Encode a TypeSpec AST; metadata tokens retain their original table identity. */
export function encodeTypeSignature(type, options = {}) {
  const writer = new Writer();
  new SignatureEncoder(writer, options).type(type, 0, options.context ?? 'type');
  return writer.finish();
}
