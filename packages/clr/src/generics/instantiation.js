import { createTypeDesc, TypeDesc, TypeKind } from '../type-system/type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';
import { GenericTypeShapes } from './type-shapes.js';

const empty = Object.freeze([]);
const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const unsupported = message => loadError(LoadErrorCode.UnsupportedFeature, message);
const invalidArguments = new Set([TypeKind.ByRef, TypeKind.Pointer, TypeKind.FunctionPointer]);

/** Reject malformed flags separately from semantic constraints that the next generic service must enforce. */
export function requireUnconstrainedParameter(parameter) {
  const attributes = parameter.genericParameterAttributes;
  if ((attributes & 3) === 3 || attributes & ~0x3f) throw fail('Invalid generic parameter attributes');
  if ((attributes & ~3) || parameter.genericParameterConstraintTokens.length) {
    throw unsupported('Generic constraint enforcement requires SF-A04-T05.4 (#2463)');
  }
}

/** Validate structural construction. Semantic constraints remain an explicit, rejected #2463 boundary. */
export function requireGenericDefinition(definition) {
  if (!(definition instanceof TypeDesc) || definition.genericDefinition || definition.kind === TypeKind.GenericParameter) {
    throw fail('Generic instantiation requires a generic type definition');
  }
  const parameters = definition.genericParameters;
  if (!parameters.length) throw fail('Generic instantiation requires a generic type definition');
  for (const parameter of parameters) requireUnconstrainedParameter(parameter);
  return parameters;
}

function requireArgument(type) {
  if (!(type instanceof TypeDesc)) throw fail('Generic argument is not a TypeDesc handle');
  const loader = type.loadContext.types;
  if (invalidArguments.has(type.kind) || ['System.Void', 'System.TypedReference', 'System.ArgIterator', 'System.RuntimeArgumentHandle']
    .some(name => loader.isIntrinsic(type, name))) {
    throw fail('Generic arguments must be ordinary managed types or generic parameters');
  }
}

/** Canonical definition/argument tuples share the existing constructed-type cache and its lifetime budget. */
export class GenericTypeInstantiations {
  #context;
  #cache;
  #definitions = new WeakMap();
  #shapes;
  #maxDepth;
  #maxWork;

  constructor(context, cache, { maxDepth, maxWork }) {
    this.#context = context;
    this.#cache = cache;
    this.#maxDepth = maxDepth;
    this.#maxWork = maxWork;
    this.#shapes = new GenericTypeShapes(maxDepth);
  }

  get(definition, arguments_) {
    let parameters = this.#definitions.get(definition);
    if (!parameters) {
      parameters = requireGenericDefinition(definition);
      this.#definitions.set(definition, parameters);
    }
    if (arguments_.length !== parameters.length) throw fail('Generic argument count does not match the definition');
    for (const argument of arguments_) requireArgument(argument);
    if (arguments_.every((type, index) => type === parameters[index])) return definition;
    const definitionIdentity = this.#cache.peekIdentity(definition);
    const identities = arguments_.map(type => this.#cache.peekIdentity(type));
    let key = definitionIdentity !== undefined && identities.every(identity => identity !== undefined)
      ? `generic:${definitionIdentity}:${identities.join(',')}` : null;
    const cached = key === null ? undefined : this.#cache.get(key);
    if (cached) return cached;
    const fullName = this.#name(definition, arguments_);
    if (key === null || !this.#cache.hasIdentityKey(key)) this.#cache.ensureCapacity();
    const budget = { remaining: this.#maxWork };
    for (const argument of arguments_) {
      if (1 + this.#shapes.depth(argument, budget) >= this.#maxDepth) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Generic construction depth exceeded');
      }
    }
    if (key === null) {
      this.#cache.ensureIdentityCapacity(definition, arguments_);
      key = `generic:${this.#cache.identity(definition)}:${arguments_.map(type => this.#cache.identity(type)).join(',')}`;
    }
    const intrinsic = definition.module === null;
    const type = createTypeDesc({
      kind: TypeKind.Instantiation, context: this.#context, module: definition.module, token: definition.metadataToken,
      name: definition.name, namespace: definition.namespace, fullName, flags: definition.flags,
      declaringType: definition.declaringType, genericDefinition: definition,
      genericArguments: Object.freeze([...arguments_]), genericParameters: empty,
      containsGenericParameters: arguments_.some(argument => argument.containsGenericParameters),
      isCollectible: definition.isCollectible || arguments_.some(argument => argument.isCollectible),
      baseType: intrinsic ? definition.baseType : null, interfaces: intrinsic ? definition.interfaces : empty, loaded: intrinsic,
    });
    return this.#cache.add(key, type);
  }

  #name(definition, arguments_) {
    let length = definition.fullName.length + 2 + Math.max(0, arguments_.length - 1);
    const names = [];
    for (const type of arguments_) {
      const name = type.fullName ?? type.name;
      length += name.length;
      if (length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type name length exceeded');
      names.push(name);
    }
    return `${definition.fullName}[${names.join(',')}]`;
  }
}
