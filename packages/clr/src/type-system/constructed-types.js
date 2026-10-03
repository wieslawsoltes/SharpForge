import { cliSystemName } from '@sharpforge/cil';
import { createTypeDesc, TypeDesc, TypeKind } from './type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const requireType = type => { if (!(type instanceof TypeDesc)) throw new TypeError('Expected TypeDesc'); };
const requireResolvedParameter = type => {
  if (type.kind === TypeKind.GenericParameter && !type.isLoaded) throw fail('Metadata generic parameter construction requires generic type services');
};
const method = (name, returnType, parameters) => Object.freeze({ name, returnType, parameters: Object.freeze(parameters), hasThis: true });

/** Canonical constructed identities owned by one explicit context's type service. */
export class ConstructedTypes {
  #loader;
  #context;
  #maxTypes;
  #identities = new WeakMap();
  #nextIdentity = 0;
  #types = new Map();
  constructor(loader, context, maxTypes) { this.#loader = loader; this.#context = context; this.#maxTypes = maxTypes; }

  #identity(type) {
    requireType(type);
    if (!this.#identities.has(type)) {
      if (this.#nextIdentity >= this.#maxTypes) throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type identity limit exceeded');
      this.#identities.set(type, ++this.#nextIdentity);
    }
    return this.#identities.get(type);
  }

  #canonical(key, create) {
    if (!this.#types.has(key)) {
      if (this.#types.size >= this.#maxTypes) throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type count limit exceeded');
      const state = { module: null, ...create(), context: this.#context, token: 0, declaringType: null, loaded: true };
      if (state.fullName.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type name length exceeded');
      if (this.#types.size >= this.#maxTypes) throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type count limit exceeded');
      const type = createTypeDesc(state);
      if (state.methods) state.methods = Object.freeze(state.methods.map(member => Object.freeze({ ...member, declaringType: type })));
      this.#types.set(key, type);
    }
    return this.#types.get(key);
  }

  element(kind, element, rank = 0) {
    requireType(element);
    const elementKind = element.kind;
    const array = kind === TypeKind.Array || kind === TypeKind.SZArray;
    if (elementKind === TypeKind.ByRef || (array && ['System.Void', 'System.TypedReference']
      .some(name => this.#loader.isIntrinsic(element, name)))) throw fail(`Invalid ${kind} element ${element.fullName}`);
    if (array && (!Number.isInteger(rank) || rank < 1 || rank > 32)) throw fail('Array rank must be between 1 and 32');
    const suffix = kind === TypeKind.SZArray ? '[]' : kind === TypeKind.Array ? `[${rank === 1 ? '*' : ','.repeat(rank - 1)}]`
      : kind === TypeKind.Pointer ? '*' : '&';
    return this.#canonical(`${kind}:${this.#identity(element)}:${rank}`, () => {
      requireResolvedParameter(element);
      const baseType = array ? this.#loader.intrinsic('System.Array') : null;
      const interfaces = array ? [...baseType.interfaces] : [];
      if (kind === TypeKind.SZArray && ![TypeKind.Pointer, TypeKind.FunctionPointer].includes(elementKind)) {
        for (const name of ['IEnumerable', 'ICollection', 'IList', 'IReadOnlyCollection', 'IReadOnlyList']) {
          const definition = this.#loader.intrinsic(`System.Collections.Generic.${name}\`1`);
          interfaces.push(this.#intrinsicInstance(definition, [element]));
        }
      }
      return { kind, name: `${element.name}${suffix}`, namespace: element.namespace, fullName: `${element.fullName}${suffix}`,
        module: element.module, elementType: element, rank, baseType, interfaces: Object.freeze([...new Set(interfaces)]),
        methods: array ? this.#arrayMethods(element, rank, kind === TypeKind.SZArray) : Object.freeze([]) };
    });
  }

  #intrinsicInstance(definition, arguments_) {
    if (definition.module || definition.genericParameters.length !== arguments_.length) throw fail('Invalid intrinsic generic definition');
    return this.#canonical(`generic:${this.#identity(definition)}:${arguments_.map(type => this.#identity(type)).join(',')}`, () => ({
      kind: TypeKind.Instantiation, name: definition.name, namespace: definition.namespace,
      fullName: `${definition.fullName}[${arguments_.map(type => type.fullName).join(',')}]`, genericDefinition: definition,
      genericArguments: Object.freeze([...arguments_]), baseType: definition.baseType, interfaces: definition.interfaces,
    }));
  }

  #arrayMethods(element, rank, szarray) {
    const integer = this.#loader.intrinsic('System.Int32');
    const voidType = this.#loader.intrinsic('System.Void');
    const indices = Array(rank).fill(integer);
    const methods = [method('Get', element, indices), method('Set', voidType, [...indices, element]),
      method('Address', this.#loader.byRef(element), indices), method('.ctor', voidType, indices)];
    if (!szarray) methods.push(method('.ctor', voidType, Array(rank * 2).fill(integer)));
    else {
      let arity = 1;
      // CoreCLR exposes one length constructor for each consecutive vector level.
      for (let nested = element; nested.kind === TypeKind.SZArray; nested = nested.elementType) {
        methods.push(method('.ctor', voidType, Array(++arity).fill(integer)));
      }
    }
    return Object.freeze(methods);
  }

  functionPointer({ returnType, parameters = [], callingConvention = 0, hasThis = false, explicitThis = false,
    genericArity = 0, sentinel = -1 } = {}) {
    requireType(returnType);
    if (parameters.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Function pointer parameter limit exceeded');
    for (const parameter of parameters) requireType(parameter);
    if (parameters.some(parameter => this.#loader.isIntrinsic(parameter, 'System.Void'))) throw fail('Function pointer parameters cannot be void');
    if (![0, 1, 2, 3, 4, 5, 9, 11].includes(callingConvention) || (explicitThis && !hasThis) ||
        !Number.isInteger(genericArity) || genericArity < 0 || genericArity > 1024 ||
        (genericArity && ![0, 5].includes(callingConvention)) || !Number.isInteger(sentinel) || sentinel < -1 ||
        sentinel >= parameters.length || (sentinel >= 0 && ![5, 11].includes(callingConvention))) throw fail('Invalid function pointer signature');
    const key = `fn:${callingConvention}:${Boolean(hasThis)}:${Boolean(explicitThis)}:${genericArity}:${sentinel}:` +
      `${this.#identity(returnType)}:${parameters.map(parameter => this.#identity(parameter)).join(',')}`;
    return this.#canonical(key, () => {
      requireResolvedParameter(returnType);
      for (const parameter of parameters) requireResolvedParameter(parameter);
      return { kind: TypeKind.FunctionPointer, name: 'method', namespace: '', fullName: 'method',
        signature: Object.freeze({ returnType, parameters: Object.freeze([...parameters]), callingConvention,
          hasThis: Boolean(hasThis), explicitThis: Boolean(explicitThis), genericArity, sentinel }) };
    });
  }

  async signature(signature, resolveType, signal) {
    checkCancellation(signal);
    if (signature.kind === 'primitive') return this.#loader.intrinsic(cliSystemName(signature.name));
    if (['class', 'valuetype'].includes(signature.kind)) {
      const type = await resolveType(signature.token);
      const value = [TypeKind.ValueType, TypeKind.Enum].includes(type.kind);
      if ((signature.kind === 'valuetype') !== value) throw fail('Signature class/value category does not match its definition');
      return type;
    }
    if (['szarray', 'array', 'pointer', 'byref'].includes(signature.kind)) {
      const element = await this.signature(signature.element, resolveType, signal);
      return this.#loader.constructElement(signature.kind, element, signature.kind === 'szarray' ? 1 : signature.rank ?? 0);
    }
    if (signature.kind === 'functionPointer') {
      const parameters = [];
      for (const parameter of signature.signature.parameters) parameters.push(await this.signature(parameter, resolveType, signal));
      const returnType = await this.signature(signature.signature.returnType, resolveType, signal);
      return this.functionPointer({ ...signature.signature, returnType, parameters });
    }
    throw fail(`Signature type ${signature.kind} requires generic/modifier type services`);
  }
}

/** Match an exact synthetic array signature; these descriptors do not execute array operations. */
export function resolveArrayMethod(type, name, returnType, parameters) {
  if (![TypeKind.Array, TypeKind.SZArray].includes(type.kind)) throw fail('Array member resolution requires an array');
  const match = type.methods.find(member => member.name === name && member.returnType === returnType &&
    member.parameters.length === parameters.length && member.parameters.every((parameter, index) => parameter === parameters[index]));
  if (!match) throw fail(`Array member ${name} signature does not exist`);
  return match;
}
