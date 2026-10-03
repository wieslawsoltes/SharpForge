export const TypeKind = Object.freeze({ Definition: 'definition', Class: 'class', ValueType: 'valuetype', Enum: 'enum', Interface: 'interface' });

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
  get isInterface() { return Boolean(this.flags & 0x20) || this.#state.kind === TypeKind.Interface; }
  get module() { return this.#state.module; }
  get assembly() { return this.module?.assembly ?? null; }
  get loadContext() { return this.#state.context ?? this.assembly.loadContext; }
  get metadataToken() { return this.#state.token; }
  get declaringType() { return this.#state.declaringType; }
  get baseType() { return this.#state.baseType ?? null; }
  get interfaces() { return this.#state.interfaces ?? empty; }
  get underlyingType() { return this.#state.underlyingType ?? null; }
  get isLoaded() { return this.#state.loaded === true; }
  toString() { return this.fullName; }
  static complete(type, graph, key) {
    if (key !== creationKey) throw new TypeError('Type graphs are completed by their context type service');
    Object.assign(type.#state, graph);
  }
}

const creationKey = Symbol('TypeDesc creation');
const empty = Object.freeze([]);
export function createTypeDesc(state) { return new TypeDesc(state, creationKey); }
export function completeTypeDesc(type, graph) { TypeDesc.complete(type, graph, creationKey); }
