import { Writer, CilError } from '../binary.js';
import { codedIndex } from './indices.js';
import {
  signaturePrimitives, signatureBudget, signatureCount, checkSignatureType, checkMethodHeader,
} from './signature-types.js';


function encoder(writer, options) {
  const budget = signatureBudget(options);
  const reference = value => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || !(value & 0xffffff)) {
      throw new CilError('Invalid signature type token');
    }
    writer.compressed(codedIndex('TypeDefOrRef', value));
  };
  function values(items, label) {
    if (!Array.isArray(items)) throw new CilError(`Invalid ${label}`);
    writer.compressed(signatureCount(items.length, label));
  }
  const handlers = {
    primitive(node) { writer.u8(signaturePrimitives[node.name]); },
    class(node) { writer.u8(0x12); reference(node.token); },
    valuetype(node) { writer.u8(0x11); reference(node.token); },
    pointer(node, depth) { writer.u8(0x0f); type(node.element, depth + 1, 'pointer'); },
    byref(node, depth) { writer.u8(0x10); type(node.element, depth + 1); },
    szarray(node, depth) { writer.u8(0x1d); type(node.element, depth + 1); },
    pinned(node, depth) { writer.u8(0x45); type(node.element, depth + 1, 'localUnpinned'); },
    modreq(node, depth, context) { writer.u8(0x1f); reference(node.token); type(node.element, depth + 1, context); },
    modopt(node, depth, context) { writer.u8(0x20); reference(node.token); type(node.element, depth + 1, context); },
    genericParameter(node) {
      if (!['type', 'method'].includes(node.scope)) throw new CilError('Invalid generic parameter scope');
      writer.u8(node.scope === 'type' ? 0x13 : 0x1e).compressed(signatureCount(node.index, 'Generic parameter index'));
    },
    genericInstance(node, depth) {
      if (!['class', 'valuetype'].includes(node.type?.kind)) throw new CilError('Generic instance requires a class or valuetype');
      if (!node.arguments?.length) throw new CilError('Generic instance requires arguments');
      writer.u8(0x15);
      type(node.type, depth + 1);
      values(node.arguments, 'Generic arguments');
      for (const argument of node.arguments) type(argument, depth + 1);
    },
    functionPointer(node, depth) {
      if (node.signature?.kind !== 'method') throw new CilError('Function pointer requires a method signature');
      writer.u8(0x1b);
      method(node.signature, depth + 1);
    },
  };
  function type(node, depth = 0, context = 'type') {
    budget(depth);
    checkSignatureType(node, context);
    if (!Object.hasOwn(handlers, node.kind)) throw new CilError('Unknown signature type kind');
    handlers[node.kind](node, depth, context);
  }
  function method(node, depth = 0) {
    budget(depth);
    if (!Array.isArray(node.parameters)) throw new CilError('Invalid signature parameters');
    const property = node.kind === 'property';
    writer.u8(property ? 8 | (node.hasThis ? 0x20 : 0) : checkMethodHeader(node));
    if (!property && node.genericArity) writer.compressed(node.genericArity);
    values(node.parameters, 'Parameters');
    type(node.returnType, depth + 1, property ? 'property' : 'return');
    node.parameters.forEach((parameter, index) => {
      if (!property && node.sentinel === index) writer.u8(0x41);
      type(parameter, depth + 1, 'parameter');
    });
  }
  function signature(node) {
    if (!node || typeof node !== 'object') throw new CilError('Invalid signature');
    if (node.kind === 'field') {
      writer.u8(6);
      type(node.type, 0, 'field');
    } else if (node.kind === 'locals' || node.kind === 'methodSpec') {
      const locals = node.kind === 'locals';
      const items = locals ? node.types : node.arguments;
      if (!locals && !items?.length) throw new CilError('MethodSpec requires arguments');
      writer.u8(locals ? 7 : 10);
      values(items, 'Signature types');
      for (const item of items) type(item, 0, locals ? 'local' : 'type');
    } else if (node.kind === 'method' || node.kind === 'property') method(node);
    else throw new CilError('Unknown signature kind');
  }
  return { type, signature };
}

/** Encode an AST signature with ECMA-335 context checks and bounded traversal. */
export function encodeSignature(signature, options = {}) {
  const writer = new Writer();
  encoder(writer, options).signature(signature);
  return writer.finish();
}

/** Encode a TypeSpec AST; metadata tokens retain their original table identity. */
export function encodeTypeSignature(type, options = {}) {
  const writer = new Writer();
  encoder(writer, options).type(type, 0, options.context ?? 'type');
  return writer.finish();
}
