import { decodeCoded } from '@sharpforge/cil';
import { createTypeDesc, TypeKind } from './type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const empty = Object.freeze([]);

/** Canonical TypeDef/MethodDef-owned GenericParam identities; constraints remain unresolved tokens. */
export class MetadataGenericParameters {
  #module;
  #index;
  #owners = new Map();
  #descriptors = new Map();
  constructor(module) { this.#module = module; }

  #readIndex() {
    try { return this.#buildIndex(); }
    catch (error) {
      if (typeof error.code === 'string' && error.code.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid generic metadata: ${error.message}`);
    }
  }

  #buildIndex() {
    if (this.#index) return this.#index;
    const count = this.#module.rowCount(42);
    const constraintCount = this.#module.rowCount(44);
    if (count + constraintCount > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Generic metadata row limit exceeded');
    const parameters = new Map();
    const owners = new Map();
    for (let rid = 1; rid <= count; rid++) {
      const token = 0x2a000000 + rid;
      const [position, attributes, owner, nameIndex] = this.#module.row(token);
      const ownerToken = decodeCoded('TypeOrMethodDef', owner);
      if (!(ownerToken & 0xffffff) || (ownerToken & 0xffffff) > this.#module.rowCount(ownerToken >>> 24)) throw fail('Invalid GenericParam owner');
      if (position >= 1024) throw loadError(LoadErrorCode.LimitExceeded, 'Generic parameter count exceeds 1024');
      const name = this.#module.string(nameIndex);
      if (name.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Generic parameter name limit exceeded');
      if (!owners.has(ownerToken)) owners.set(ownerToken, new Map());
      const group = owners.get(ownerToken);
      if (group.has(position)) throw fail('Duplicate generic parameter position');
      const parameter = { token, position, attributes, ownerToken, name, constraints: new Set() };
      parameters.set(token, parameter);
      group.set(position, parameter);
    }
    for (const group of owners.values()) {
      for (let position = 0; position < group.size; position++) {
        if (!group.has(position)) throw fail('Generic parameter positions must be contiguous');
      }
    }
    for (let rid = 1; rid <= constraintCount; rid++) {
      const [owner, constraint] = this.#module.row(0x2c000000 + rid);
      const parameter = parameters.get(0x2a000000 + owner);
      if (!parameter) throw fail('Invalid GenericParamConstraint owner');
      const token = decodeCoded('TypeDefOrRef', constraint);
      if (!(token & 0xffffff) || (token & 0xffffff) > this.#module.rowCount(token >>> 24)) throw fail('Invalid generic constraint type');
      if (parameter.constraints.has(token)) throw fail('Duplicate generic parameter constraint');
      parameter.constraints.add(token);
    }
    this.#index = { parameters, owners };
    return this.#index;
  }

  forType(token) {
    const owner = this.#module.typeDefinition(token);
    return this.#forOwner(token, owner, owner, null);
  }

  forMethod(token) {
    const owner = this.#module.methodDefinition(token);
    if (this.#owners.has(token)) return this.#owners.get(token);
    const arity = owner.signature.genericArity;
    if (arity > 1024) throw loadError(LoadErrorCode.LimitExceeded, 'Generic parameter count exceeds 1024');
    if ((this.#readIndex().owners.get(token)?.size ?? 0) !== arity) {
      throw fail('Method generic parameter count does not match its signature arity');
    }
    return this.#forOwner(token, owner, owner.declaringType, owner);
  }

  #forOwner(token, owner, declaringType, declaringMethod) {
    if (this.#owners.has(token)) return this.#owners.get(token);
    const group = this.#readIndex().owners.get(token);
    if (!group) return empty;
    const result = [];
    for (let position = 0; position < group.size; position++) {
      const parameter = group.get(position);
      const descriptor = createTypeDesc({ name: parameter.name, namespace: declaringType.namespace, fullName: null,
        kind: TypeKind.GenericParameter, module: this.#module, token: parameter.token, declaringType, declaringMethod,
        owner, position, genericParameterAttributes: parameter.attributes,
        constraintTokens: Object.freeze([...parameter.constraints]) });
      this.#descriptors.set(parameter.token, descriptor);
      result.push(descriptor);
    }
    this.#owners.set(token, Object.freeze(result));
    return this.#owners.get(token);
  }

  get(token) {
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== 42 || !(token & 0xffffff)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Generic parameter requires a GenericParam token');
    }
    const parameter = this.#readIndex().parameters.get(token);
    if (!parameter) throw loadError(LoadErrorCode.InvalidImage, 'GenericParam row does not exist');
    if (parameter.ownerToken >>> 24 === 2) this.forType(parameter.ownerToken);
    else this.forMethod(parameter.ownerToken);
    return this.#descriptors.get(token);
  }
}
