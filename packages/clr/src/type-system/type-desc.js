export const TypeKind = Object.freeze({
  Definition: 'definition', Class: 'class', ValueType: 'valuetype', Enum: 'enum', Interface: 'interface',
  SZArray: 'szarray', Array: 'array', Pointer: 'pointer', ByRef: 'byref', FunctionPointer: 'functionPointer',
  GenericParameter: 'genericParameter', Instantiation: 'instantiation',
});

/** A canonical metadata identity whose graph is completed explicitly by its context type service. */
export class TypeDesc {
  #state;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Type descriptors are created by their runtime module');
    this.#state = state;
    Object.freeze(this);
  }
  get name() { return this.#state.name; }
  get namespace() { return this.#state.namespace; }
  get fullName() { return this.#state.fullName; }
  get flags() { return this.#state.flags ?? 0; }
  get kind() { return this.#state.kind ?? (this.isInterface ? TypeKind.Interface : TypeKind.Definition); }
  get isInterface() { return Boolean(this.flags & 0x20) || this.#state.kind === TypeKind.Interface || this.genericDefinition?.isInterface === true; }
  get module() { return this.#state.module; }
  get assembly() { return this.module?.assembly ?? null; }
  get loadContext() { return this.#state.context ?? this.assembly.loadContext; }
  get metadataToken() { return this.#state.token; }
  get declaringType() { return this.#state.declaringType; }
  get declaringMethod() { return this.#state.declaringMethod ?? null; }
  get baseType() { return this.#state.baseType ?? null; }
  get interfaces() { return this.#state.interfaces ?? empty; }
  get underlyingType() { return this.#state.underlyingType ?? null; }
  get isLoaded() { return this.#state.loaded === true; }
  get elementType() { return this.#state.elementType ?? null; }
  get rank() { return this.#state.rank ?? 0; }
  get methods() { return this.#state.methods ?? empty; }
  get signature() { return this.#state.signature ?? null; }
  get genericDefinition() { return this.#state.genericDefinition ?? null; }
  get genericArguments() { return this.#state.genericArguments ?? empty; }
  get genericParameters() {
    return this.#state.genericParameters ??= (this.metadataToken >>> 24 === 2 ? this.module.genericParameters(this.metadataToken) : empty);
  }
  get genericParameterPosition() { return this.#state.position ?? -1; }
  get genericParameterOwner() { return this.#state.owner ?? null; }
  get genericParameterAttributes() { return this.#state.genericParameterAttributes ?? 0; }
  get genericParameterConstraintTokens() { return this.#state.constraintTokens ?? empty; }
  toString() { return this.fullName ?? this.name; }
  static complete(type, graph, key) {
    if (key !== creationKey) throw new TypeError('Type graphs are completed by their context type service');
    Object.assign(type.#state, graph);
  }
}

const creationKey = Symbol('TypeDesc creation');
const empty = Object.freeze([]);
export function createTypeDesc(state) { return new TypeDesc(state, creationKey); }
export function completeTypeDesc(type, graph) { TypeDesc.complete(type, graph, creationKey); }
