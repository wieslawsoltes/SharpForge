import { CilError } from '../binary.js';
import { signaturePrimitives, signaturePrimitiveNames, signatureSystemNames, signatureAliases } from './signature-types.js';
import { decodeSignature, decodeTypeSignature } from './signatures.js';
import { decodeCoded } from './indices.js';

export const customAttributeDiagnosticCatalog = Object.freeze({
  MD0100: 'Invalid custom attribute input',
  MD0101: 'Custom attribute prolog must be 0x0001',
  MD0102: 'Truncated custom attribute blob',
  MD0103: 'Invalid custom attribute argument type',
  MD0104: 'Custom attribute enum underlying type cannot be resolved',
  MD0105: 'Invalid custom attribute named argument',
  MD0106: 'Invalid custom attribute constructor',
  MD0107: 'Trailing custom attribute bytes',
  MD0108: 'Custom attribute complexity or size limit exceeded',
  MD0109: 'Custom attribute operation cancelled',
  MD0110: 'Invalid custom attribute value',
});

export class AttributeError extends CilError {
  constructor(code, detail, offset) {
    super(detail ?? customAttributeDiagnosticCatalog[code], offset);
    this.code = code;
  }
}

const primitiveTypes = new Map(Object.entries(signaturePrimitives)
  .filter(([, code]) => code >= 2 && code <= 14)
  .map(([name, code]) => [code, Object.freeze({ code, type: signatureSystemNames[name] })]));
const enumCodes = new Set([4, 5, 6, 7, 8, 9, 10, 11]);
const specialTypes = new Map([[0x50, Object.freeze({ code: 0x50, type: 'System.Type' })],
  [0x51, Object.freeze({ code: 0x51, type: 'System.Object' })]]);

function limit(value, fallback, maximum) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new AttributeError('MD0108');
  return value;
}

/** Per-operation limits and explicit metadata/type resolution; no global caches or enum guesses. */
export class AttributeContext {
  constructor(options = {}) {
    this.options = options;
    this.remaining = limit(options.maxNodes, 100000, 1000000);
    this.maxDepth = limit(options.maxDepth, 64, 256);
    this.maxBytes = limit(options.maxBytes, 16 * 1024 * 1024, 128 * 1024 * 1024);
    this.maxArrayLength = limit(options.maxArrayLength, 100000, 1000000);
    this.maxStringBytes = limit(options.maxStringBytes, Math.min(1024 * 1024, this.maxBytes), this.maxBytes);
    this.genericArguments = [];
  }

  check(depth = 0) {
    if (this.options.signal?.aborted) throw new AttributeError('MD0109');
    if (depth > this.maxDepth || --this.remaining < 0) throw new AttributeError('MD0108');
  }

  size(value, maximum = this.maxBytes) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new AttributeError('MD0108');
    return value;
  }

  parameters(value) {
    if (Array.isArray(value)) {
      this.size(value.length, 65535);
      return value.map(type => this.descriptor(type));
    }
    const metadata = this.options.metadata;
    if (!Number.isInteger(value) || !metadata || ![6, 10].includes(value >>> 24)) throw new AttributeError('MD0106');
    const row = metadata.row(value);
    if (metadata.string(row[value >>> 24 === 6 ? 3 : 1]) !== '.ctor') throw new AttributeError('MD0106');
    const signature = decodeSignature(metadata.blob(row[value >>> 24 === 6 ? 4 : 2]));
    if (signature.kind !== 'method' || signature.genericArity || signature.callingConvention || !signature.hasThis ||
        signature.returnType.kind !== 'primitive' || signature.returnType.name !== 'void') throw new AttributeError('MD0106');
    if (value >>> 24 === 10) {
      const owner = decodeCoded('MemberRefParent', row[0]);
      if (owner >>> 24 === 27) {
        const type = decodeTypeSignature(metadata.blob(metadata.row(owner)[0]));
        if (type.kind !== 'genericInstance') throw new AttributeError('MD0106');
        this.genericArguments = type.arguments;
      }
    }
    return signature.parameters.map(type => this.descriptor(type));
  }

  enumType(name, token, underlying) {
    if (typeof name !== 'string' || !name.length) throw new AttributeError('MD0104');
    underlying ??= this.options.enumUnderlyingType?.(name, token);
    if (typeof underlying === 'string') {
      const alias = Object.hasOwn(signatureAliases, underlying) ? signatureAliases[underlying] : underlying;
      underlying = Object.hasOwn(signaturePrimitives, alias) ? signaturePrimitives[alias] : undefined;
    }
    if (underlying === undefined && token >>> 24 === 2 && this.options.metadata) {
      const metadata = this.options.metadata;
      for (const field of metadata.list(token, 'FieldList')) {
        const row = metadata.row(field);
        if (metadata.string(row[1]) === 'value__') {
          const type = decodeSignature(metadata.blob(row[2])).type;
          underlying = signaturePrimitives[type?.name];
          break;
        }
      }
    }
    if (!enumCodes.has(underlying)) throw new AttributeError('MD0104', `Cannot resolve enum underlying type: ${name}`);
    return { code: 0x55, type: name, underlying };
  }

  descriptor(node, depth = 0, element = false) {
    this.check(depth);
    if (typeof node === 'string') node = { kind: 'primitive', name: node };
    if (!node || typeof node !== 'object') throw new AttributeError('MD0103');
    if (node.kind === 'genericParameter') {
      if (node.scope !== 'type' || !this.genericArguments[node.index]) throw new AttributeError('MD0103');
      return this.descriptor(this.genericArguments[node.index], depth + 1, element);
    }
    if (node.kind === 'szarray' || node.code === 0x1d) {
      if (element) throw new AttributeError('MD0103', 'Jagged custom attribute arrays are invalid');
      return { code: 0x1d, element: this.descriptor(node.element, depth + 1, true) };
    }
    if (node.kind === 'enum' || node.code === 0x55) return this.enumType(node.name ?? node.type, node.token, node.underlying);
    let name = node.name;
    if (['class', 'valuetype', 'type'].includes(node.kind) && node.token !== undefined) {
      name = this.options.typeName?.(node.token) ?? this.options.metadata?.typeName(node.token);
      if (name !== 'System.Type' && name !== 'System.Object') return this.enumType(name, node.token);
    }
    if (name === 'System.Type') return specialTypes.get(0x50);
    const alias = Object.hasOwn(signatureAliases, name) ? signatureAliases[name] : name;
    const code = node.code ?? (Object.hasOwn(signaturePrimitives, alias) ? signaturePrimitives[alias] : undefined);
    if (code === 28) return specialTypes.get(0x51);
    const type = primitiveTypes.get(code) ?? specialTypes.get(code);
    if (!type) throw new AttributeError('MD0103');
    return type;
  }
}

export function attributePrimitiveName(code) {
  return signatureSystemNames[signaturePrimitiveNames[code]];
}
