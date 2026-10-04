import { cliSystemName, decodeCoded, formatSignatureType } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

const unsupported = message => loadError(LoadErrorCode.TypeLoad, message);
const limit = () => loadError(LoadErrorCode.LimitExceeded, 'Method display limit exceeded');
const identifier = value => {
  if (/[,+\[\]&*\\]/.test(value)) throw unsupported('Escaped reflection type identifiers require resolved type formatting');
  return value;
};

class MethodDisplayTypes {
  #method;
  #names = new Map();
  #nodes = 0;
  #characters = 0;
  #genericNamesChecked = false;
  constructor(method) { this.#method = method; }
  bounded(value) {
    if ((this.#characters += value.length) > 16384) throw limit();
    return value;
  }
  named(token) {
    if (this.#names.has(token)) return this.#names.get(token);
    const table = token >>> 24;
    if (table !== 1 && table !== 2) throw unsupported('TypeSpec display requires resolved type formatting');
    const row = this.#method.module.row(token);
    const name = identifier(this.#method.module.string(row[1], { maxBytes: 16384 }));
    const namespace = identifier(this.#method.module.string(row[2], { maxBytes: 16384 }));
    const fullName = this.#method.module.typeName(token);
    const nested = table === 2 ? (row[0] & 7) > 1 : (row[0] & 3) === 3;
    const result = { name, namespace, fullName, nested };
    this.#names.set(token, result);
    return result;
  }
  nestedName(token, name) {
    if (name.checkedAncestors) return name.fullName;
    const module = this.#method.module;
    let depth = 0;
    if (token >>> 24 === 2) {
      for (let parent = module.typeDefinition(token).declaringType; parent; parent = parent.declaringType) {
        if (++depth > 64) throw limit();
        identifier(parent.name);
        identifier(parent.namespace);
      }
    } else {
      let parent = decodeCoded('ResolutionScope', module.row(token)[0]);
      while (parent >>> 24 === 1) {
        if (++depth > 64) throw limit();
        const row = module.row(parent);
        identifier(module.string(row[1], { maxBytes: 16384 }));
        identifier(module.string(row[2], { maxBytes: 16384 }));
        parent = decodeCoded('ResolutionScope', row[0]);
      }
    }
    name.checkedAncestors = true;
    return name.fullName;
  }
  parameters(owner) {
    if (!this.#genericNamesChecked) {
      const count = this.#method.module.rowCount(42);
      if (count + this.#method.module.rowCount(44) > 4096) throw limit();
      let total = 0;
      // The existing GenericParam index reads all names. Bound them before asking it to materialize descriptors.
      for (let row = 1; row <= count; row++) {
        const name = this.#method.module.string(this.#method.module.row(0x2a000000 + row)[3], { maxBytes: 16384 });
        if (name.length > 4096 || (total += name.length) > 16384) throw limit();
      }
      this.#genericNamesChecked = true;
    }
    return owner.genericParameters;
  }
  rootElement(type) {
    let depth = 0;
    while (type.element) {
      if (++depth > 32) throw limit();
      type = type.element;
    }
    return type.kind === 'genericInstance' ? type.type : type;
  }
  display(type, parameter = false) {
    const root = this.rootElement(type);
    const namedRoot = ['class', 'valuetype'].includes(root.kind) ? this.named(root.token) : null;
    const simple = root.kind === 'primitive' ? !['object', 'string'].includes(root.name) : !!namedRoot?.nested;
    if (namedRoot && !namedRoot.nested && namedRoot.namespace === 'System' &&
        ['Void', 'Boolean', 'Char', 'SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64',
          'Single', 'Double', 'IntPtr', 'UIntPtr', 'TypedReference'].includes(namedRoot.name)) {
      throw unsupported('Named primitive aliases require resolved type formatting');
    }
    const formatType = (node, child) => {
      if (++this.#nodes > 1024) throw limit();
      if (node.kind === 'primitive') {
        const name = cliSystemName(node.name);
        return this.bounded(simple ? name.slice(7) : name);
      }
      if (node.kind === 'class' || node.kind === 'valuetype') {
        const name = this.named(node.token);
        return this.bounded(simple ? name.name : name.nested ? this.nestedName(node.token, name) : name.fullName);
      }
      if (node.kind === 'genericParameter') {
        const owner = node.scope === 'method' ? this.#method : this.#method.declaringType;
        const value = this.parameters(owner)[node.index];
        if (!value) throw loadError(LoadErrorCode.InvalidImage, 'Generic display parameter is outside its owner');
        return this.bounded(value.name);
      }
      if (node.kind === 'genericInstance') {
        return simple ? child(node.type) : child(node.type) + '[' + node.arguments.map(child).join(',') + ']';
      }
      if (node.kind === 'modreq' || node.kind === 'modopt') {
        this.#method.module.row(node.token);
        return child(node.element);
      }
      if (node.kind === 'array') {
        if (node.sizes.length || node.lowerBounds.some(bound => bound !== 0)) {
          throw unsupported('Sized and nonzero-bound array displays require resolved types');
        }
        return child(node.element) + '[' + (node.rank === 1 ? '*' : ','.repeat(node.rank - 1)) + ']';
      }
      if (node.kind === 'functionPointer') throw unsupported('Function pointer displays require resolved types');
      return undefined;
    };
    let result = formatSignatureType(type, null, { formatType, maxDepth: 32, maxNodes: 1024 });
    let outer = type;
    while (outer.kind === 'modreq' || outer.kind === 'modopt') outer = outer.element;
    if (parameter && outer.kind === 'byref') result = result.slice(0, -1) + ' ByRef';
    return this.bounded(result);
  }
}

/** Reflection-style metadata display; external type binding and executable method validity remain separate. */
export function formatMethodDisplay(method) {
  try {
    const signature = method.signature;
    if (![0, 5].includes(signature.callingConvention) || signature.explicitThis || signature.sentinel >= 0) {
      throw unsupported('Method display requires a default or vararg MethodDef signature');
    }
    if (signature.parameters.length > 256) throw limit();
    const types = new MethodDisplayTypes(method);
    const returnType = types.display(signature.returnType);
    const generics = signature.genericArity ? '[' + types.parameters(method).map(value => value.name).join(',') + ']' : '';
    types.bounded(method.name + generics);
    const argumentsList = signature.parameters.map(type => types.display(type, true));
    if (signature.callingConvention === 5) argumentsList.push('...');
    const result = `${returnType} ${method.name}${generics}(${argumentsList.join(', ')})`;
    if (result.length > 16384) throw limit();
    return result;
  } catch (error) {
    if (error.code?.startsWith('SFCLR')) throw error;
    throw loadError(LoadErrorCode.InvalidImage, `Invalid method display: ${error.message}`);
  }
}
