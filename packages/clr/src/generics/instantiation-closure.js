import { TypeDesc, TypeKind } from '../type-system/type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';
import { ClosureGraph } from './closure-graph.js';
import { definitionBindings, sameDefinitionBindings } from './definition-bindings.js';

const nominal = new Set([TypeKind.Definition, TypeKind.Class, TypeKind.Interface, TypeKind.ValueType, TypeKind.Enum]);
const fail = message => loadError(LoadErrorCode.TypeLoad, message);

/** Weak, bounded success admissions only; pending metadata, graphs and foreign contexts belong to a root operation. */
export class InstantiationClosures {
  #valid = new WeakSet();
  #count = 0;
  #maxEntries;
  #maxDepth;
  #read;
  #observe;

  constructor(read, { maxEntries, maxDepth }, observe = null) {
    this.#read = read;
    this.#observe = observe;
    this.#maxEntries = maxEntries;
    this.#maxDepth = maxDepth;
  }

  has(type) { return this.#valid.has(type); }
  operation(work) { return new InstantiationClosure(this, work, { read: this.#read, observe: this.#observe }, this.#maxDepth); }

  admit(types) {
    for (const type of types) {
      if (this.#count >= this.#maxEntries) break;
      if (!this.#valid.has(type)) {
        this.#valid.add(type);
        this.#count++;
      }
    }
  }
}

/** Completed local proofs can be reused; a reentrant host callback gets an independent, unpublished proof graph. */
class InstantiationClosure {
  #cache;
  #work;
  #services;
  #maxDepth;
  #proven = new Set();
  #templates = new Map();
  #releases = [];

  constructor(cache, work, services, maxDepth) {
    this.#cache = cache;
    this.#work = work;
    this.#services = services;
    this.#maxDepth = maxDepth;
  }

  has(type) { return this.#cache.has(type) || this.#proven.has(type); }
  template(type) { return this.#templates.get(type); }

  async read(type, operation) {
    this.#work.visit();
    const cached = this.#templates.get(type);
    if (cached) return cached;
    const resolved = await this.#services.read(type, operation);
    this.#work.visit();
    // Reentrant readers never await a pending self-promise. The first completed template owns this root's bindings.
    const completed = this.#templates.get(type);
    if (completed) return completed;
    const expected = definitionBindings(resolved.baseType, resolved.interfaces);
    const observed = this.#services.observe?.(type, expected, this.#work) ?? { binding: expected, release: null };
    if (observed.release) this.#releases.push(observed.release);
    this.#templates.set(type, observed.binding);
    return observed.binding;
  }

  verifyBinding(type, binding) {
    const expected = this.#templates.get(type);
    if (expected && !sameDefinitionBindings(expected, binding)) this.#work.invalidateBindings();
    this.#work.visit(0);
  }

  releaseBindings() {
    const releases = this.#releases;
    this.#releases = [];
    for (const release of releases) release();
  }

  async require(type, operation) {
    this.#work.observe(type);
    if (this.has(type)) return;
    const proof = new ClosureProof(this, this.#work, this.#maxDepth);
    try {
      await proof.require(type, operation);
      for (const proven of proof.proven()) {
        this.#work.visit();
        this.#proven.add(proven);
      }
    } finally {
      proof.dispose();
    }
  }

  /** Only the successful root admits weak cache entries, after its final lifetime/cancellation poll. */
  publish() {
    // An unloaded definition can still bind its TypeRefs differently on a later host callback.
    // Only completed canonical graphs make a cross-operation proof immutable.
    for (const type of this.#templates.keys()) if (!type.isLoaded) return;
    this.#cache.admit(this.#proven);
  }

  dispose() {
    this.releaseBindings();
    this.#proven.clear();
    this.#templates.clear();
  }
}

/** ECMA II.9.1/II.9.2 over canonical owner-scoped formals, without expanding substituted inheritance graphs. */
class ClosureProof {
  #cache;
  #work;
  #maxDepth;
  #definitions = new Set();
  #shapes = new Set();
  #forms = new Set();
  #pending = [];
  #position = 0;
  #parameters;
  #inheritance;
  #disposed = false;

  constructor(cache, work, maxDepth) {
    this.#cache = cache;
    this.#work = work;
    this.#maxDepth = maxDepth;
    this.#parameters = new ClosureGraph(work);
    this.#inheritance = new ClosureGraph(work);
  }

  #visit(depth = 0) {
    this.#work.visit();
    if (this.#disposed) throw loadError(LoadErrorCode.Disposed, 'Generic closure operation has ended');
    if (depth >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Generic instantiation closure depth exceeded');
  }

  #definition(type, depth) {
    this.#visit(depth);
    if (this.#cache.has(type) || this.#definitions.has(type)) return;
    if (!nominal.has(type.kind)) throw fail('Generic inheritance closure requires a nominal type definition');
    this.#definitions.add(type);
    this.#inheritance.node(type);
    for (const parameter of type.genericParameters) this.#parameters.node(parameter);
    this.#pending.push({ type, depth });
  }

  #children(type) {
    if (type.elementType) return [type.elementType];
    if (type.kind === TypeKind.FunctionPointer) return [type.signature.returnType, ...type.signature.parameters];
    if (type.genericDefinition) return type.genericArguments;
    return type.genericParameters;
  }

  #discover(type, depth = 0) {
    this.#visit(depth);
    if (!(type instanceof TypeDesc)) throw fail('Generic closure requires canonical type handles');
    this.#work.observe(type);
    if (this.#cache.has(type) || this.#shapes.has(type)) return;
    this.#shapes.add(type);
    if (type.kind === TypeKind.GenericParameter) {
      const owner = type.genericParameterOwner;
      this.#definition(owner instanceof TypeDesc ? owner : owner.declaringType, depth);
    } else if (type.genericDefinition) this.#definition(type.genericDefinition, depth);
    else if (nominal.has(type.kind)) this.#definition(type, depth);
    for (const child of this.#children(type)) this.#discover(child, depth + 1);
  }

  #form(type, depth) {
    this.#visit(depth);
    if (this.#forms.has(type)) return;
    this.#forms.add(type);
    const definition = type.genericDefinition ?? (nominal.has(type.kind) ? type : null);
    if (definition) {
      const formals = definition.genericParameters;
      const actuals = type.genericDefinition ? type.genericArguments : formals;
      if (formals.length !== actuals.length) throw fail('Generic inheritance closure arity mismatch');
      for (let index = 0; index < formals.length; index++) this.#parameters.edge(actuals[index], formals[index], false);
    }
    // Auxiliary canonical shape vertices compress formal-occurrence paths. Containment is expanding;
    // binding an actual to a formal is not. Each unique shape is traversed once, including shared DAGs.
    for (const child of this.#children(type)) {
      this.#parameters.edge(child, type, true);
      this.#form(child, depth + 1);
    }
  }

  #template(owner, type, depth) {
    if (type === null) return;
    this.#visit(depth);
    const definition = type.genericDefinition ?? type;
    if (!nominal.has(definition.kind)) throw fail('Invalid generic base or interface type');
    this.#inheritance.edge(owner, definition, false);
    this.#discover(type, depth);
    this.#form(type, 0);
  }

  async require(type, operation) {
    this.#visit();
    this.#work.observe(type);
    if (this.#cache.has(type)) return;
    this.#discover(type);
    while (this.#position < this.#pending.length) {
      const current = this.#pending[this.#position++];
      this.#visit(current.depth);
      const template = await this.#cache.read(current.type, operation);
      this.#visit(current.depth);
      this.#template(current.type, template.baseType, current.depth + 1);
      for (const contract of template.interfaces) this.#template(current.type, contract, current.depth + 1);
    }
    this.#inheritance.rejectCycles({ expandingOnly: false, reason: 'Circular erased generic inheritance' });
    this.#parameters.rejectCycles({ expandingOnly: true, reason: 'Infinite generic instantiation closure (expanding parameter cycle)' });
  }

  *proven() {
    yield* this.#shapes;
    yield* this.#definitions;
  }

  dispose() {
    this.#disposed = true;
    for (const set of [this.#definitions, this.#shapes, this.#forms]) set.clear();
    this.#pending.length = 0;
    this.#parameters.clear();
    this.#inheritance.clear();
  }
}
