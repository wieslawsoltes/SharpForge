/**
 * Metadata tokens for the operands of instructions (SF-A02-T30): types, methods, fields, string literals and local
 * variable signatures.
 *
 * A member the compilation defines is its definition token; anything else is a MemberRef on the TypeRef or TypeSpec
 * of its containing type, with the signature of the member's original definition (so a member of `List<int>` is named
 * with `!0`, as ECMA-335 II.22.25 requires). A constructed generic method is a MethodSpec over either.
 */
import { compressUnsigned, needsMethodSpec, needsTypeSpec } from '../../codegen/generics.js';
import { SymbolKind, NamedTypeSymbol, substituteType } from '../../symbols/types.js';
import { declaringInterfaceOf, genericFrameworkMethod } from './framework-declarations.js';
import { methodTypeParameter } from './framework-types.js';
import { fieldSignature, methodSignature, methodSymbolSignature } from '../../codegen/metadata/member-signatures.js';

const LOCAL_SIGNATURE = 0x07;
const BY_REFERENCE = 0x10;
const PINNED = 0x45;
const USER_STRING = 0x70000000;
const GENERIC_METHOD_INSTANCE = 0x0a;

/**
 * The declaration a member of a constructed framework type stands for. The framework registry lists closed
 * instantiations, each with members of its own (`List<int>.Add(int)`); metadata names the member of the generic
 * definition (`List<T>.Add(T)`), which the registry bridge derives as an open member of the definition.
 */
function openDeclarationOf(owner, method) {
  const definition = owner.originalDefinition;
  if (!definition || definition === owner || !owner.typeMap) return method;
  const closes = (openType, closedType) => substituteType(openType, owner.typeMap).equals(closedType),
    matches = candidate =>
      candidate.kind === SymbolKind.Method &&
      candidate !== method &&
      !!candidate.isStatic === !!method.isStatic &&
      candidate.parameters.length === method.parameters.length &&
      candidate.parameters.every((parameter, index) => closes(parameter.type, method.parameters[index].type)) &&
      closes(candidate.returnType, method.returnType);
  return definition.getMembers(method.name).find(matches) ?? method;
}

/**
 * True for a type whose members cannot be named by their definition tokens: a constructed type, and a generic
 * definition seen from its own code (`Box<T>` inside `Box<T>`), which is the instantiation over its own type
 * parameters (ECMA-335 II.9.4: a member of a generic type is always referenced through a TypeSpec).
 */
function isInstantiation(type) {
  return needsTypeSpec(type) || (type instanceof NamedTypeSymbol && type.isDefinition && type.isGenericType);
}

export class MemberTokens {
  /** @param writer the SymbolMetadataWriter whose definition tokens are allocated */
  constructor(writer) {
    this.writer = writer;
    this.builder = writer.builder;
    this.types = writer.tokens;
    /** The tokens that encode a declaration's own signature: never under the substitution of the code that names it. */
    this.definitionTypes = writer.tokens;
    this.typeSpecs = new Map();
    this.methodSpecs = new Map();
    this.localSignatures = new Map();
  }
  /**
   * A view of these tokens for the code of a synthesized generic class or method: every type it names is read under
   * the substitution first (generic-context.js). The rows and caches are shared.
   */
  within(substitution) {
    if (!substitution) return this;
    const view = Object.create(this);
    view.types = this.definitionTypes.within(substitution);
    return view;
  }
  /** `GENERICINST` blob of a MethodSpec over the given type arguments, and its token over `parent`. */
  methodSpec(parent, typeArguments) {
    const encoded = typeArguments.flatMap(argument => this.types.signature(argument)),
      instantiation = [GENERIC_METHOD_INSTANCE, ...compressUnsigned(typeArguments.length), ...encoded],
      key = parent + ':' + instantiation.join(',');
    let token = this.methodSpecs.get(key);
    if (!token) {
      token = this.builder.addRow('MethodSpec', { Method: parent, Instantiation: Uint8Array.from(instantiation) });
      this.methodSpecs.set(key, token);
    }
    return token;
  }
  /**
   * The token that names a synthesized field or method from the body being emitted: its definition token, or - for
   * a member of a generic type - a MemberRef on the type as this code sees it; a generic method is instantiated over
   * `typeArguments`.
   * @param member a planned field or method  @param type the type definition that declares it
   */
  planned(member, type, typeArguments = []) {
    const self = type.selfType ?? type;
    let parent = member.token;
    if (isInstantiation(self)) {
      const definitionTypes = this.definitionTypes.within(member.substitution ?? type.typeSubstitution ?? null),
        signature = member.shape ? methodSignature(definitionTypes, member.shape) : fieldSignature(definitionTypes, member.type);
      parent = this.builder.member(this.type(self), member.name, signature);
    }
    return typeArguments.length ? this.methodSpec(parent, typeArguments) : parent;
  }
  /** TypeDef, TypeRef or TypeSpec token of a type (the operand of `newarr`, `box`, `isinst`, a catch clause, ...). */
  type(type) {
    if (!isInstantiation(type)) return this.types.definitionToken(type);
    const signature = this.types.signature(type),
      key = signature.join(',');
    let token = this.typeSpecs.get(key);
    if (!token) {
      token = this.builder.addRow('TypeSpec', { Signature: Uint8Array.from(signature) });
      this.typeSpecs.set(key, token);
    }
    return token;
  }
  /** MethodDef, MemberRef or MethodSpec token of a method as it is named at a call. */
  method(method) {
    const definition = method.originalDefinition ?? method,
      owner = method.containingType,
      defined = this.writer.methodTokens.get(definition),
      generic = defined ? null : genericFrameworkMethod(this.writer.core, method, methodTypeParameter);
    if (generic) return this.externalGeneric(owner, generic.name, generic.shape, generic.typeArguments);
    const parent = defined && !isInstantiation(owner) ? defined : this.memberReference(owner, definition);
    if (!needsMethodSpec(method)) return parent;
    return this.methodSpec(
      parent,
      method.typeArguments.map(argument => argument.type),
    );
  }
  memberReference(owner, definition) {
    const declaringType = declaringInterfaceOf(this.writer.core, owner, definition.name),
      declaration = openDeclarationOf(declaringType, definition);
    return this.builder.member(this.type(declaringType), declaration.metadataName, methodSymbolSignature(this.definitionTypes, declaration));
  }
  /** Field or MemberRef token of a field. */
  field(field) {
    const definition = field.originalDefinition ?? field,
      owner = field.containingType,
      defined = this.writer.fieldTokens.get(definition);
    if (defined && !isInstantiation(owner)) return defined;
    return this.builder.member(this.type(owner), definition.name, fieldSignature(this.definitionTypes, definition.type));
  }
  /**
   * MemberRef token of a framework method named by its signature rather than by a symbol (the members lowering needs
   * that the symbol table does not model, such as `String.Concat(object, object)`).
   * @param owner the type symbol that declares it
   * @param {{isStatic: boolean, returnType: object, parameters: {type: object, refKind?: string}[]}} shape
   */
  external(owner, name, shape) {
    return this.builder.member(this.type(owner), name, methodSignature(this.definitionTypes, shape));
  }
  /**
   * MethodSpec token of a generic framework method named by its signature (`shape.arity` type parameters, written
   * `methodTypeParameter(n)` in the shape) and instantiated over `typeArguments`.
   */
  externalGeneric(owner, name, shape, typeArguments) {
    return this.methodSpec(this.external(owner, name, shape), typeArguments);
  }
  /** The token of `D::.ctor(object, native int)`, which the runtime implements for every delegate type. */
  delegateConstructor(type) {
    const planned = needsTypeSpec(type) ? null : this.writer.plans.get(type.originalDefinition ?? type);
    if (planned) return planned.methods.find(method => method.name === '.ctor').token;
    const core = this.writer.core,
      shape = { isStatic: false, returnType: core.void, parameters: [{ type: core.object }, { type: core.intPtr }] };
    return this.external(type, '.ctor', shape);
  }
  /** The planned event of a source event symbol: `{adder, remover}` and, for a field-like event, its field. */
  plannedEvent(event) {
    const definition = event.originalDefinition ?? event,
      plan = this.writer.plans.get(definition.containingType);
    return plan?.events.find(entry => entry.symbol === definition) ?? null;
  }
  /** The token of the add or remove accessor of a source event, or null for an event the compilation does not define. */
  eventAccessor(event, isAdd) {
    const planned = this.plannedEvent(event);
    if (!planned) return null;
    const accessor = isAdd ? planned.adder : planned.remover,
      owner = event.containingType;
    if (!isInstantiation(owner)) return accessor.token;
    // An event of a generic type is reached through the instantiation, like any member of it.
    const signature = accessor.symbol ? methodSymbolSignature(this.types, accessor.symbol) : methodSignature(this.types, accessor.shape);
    return this.builder.member(this.type(owner), accessor.name, signature);
  }
  /** The token of the delegate field of a field-like source event, or null when the event has none. */
  eventField(event) {
    const definition = event.originalDefinition ?? event,
      plan = this.writer.plans.get(definition.containingType),
      field = plan?.fields.find(entry => !entry.symbol && entry.name === definition.name),
      owner = event.containingType;
    if (!field) return null;
    if (!isInstantiation(owner)) return field.token;
    return this.builder.member(this.type(owner), field.name, fieldSignature(this.types, field.type));
  }
  /** The operand of `ldstr`. */
  string(text) {
    return USER_STRING | this.builder.userString(text);
  }
  /**
   * StandAloneSig token of a local variable signature, or 0 for a method without locals.
   * @param {{type: object, isByReference: boolean, isPinned: boolean}[]} locals
   */
  locals(locals) {
    if (!locals.length) return 0;
    const bytes = [LOCAL_SIGNATURE, ...compressUnsigned(locals.length)];
    for (const local of locals) {
      if (local.isPinned) bytes.push(PINNED);
      if (local.isByReference) bytes.push(BY_REFERENCE);
      bytes.push(...this.types.signature(local.type));
    }
    const key = bytes.join(',');
    let token = this.localSignatures.get(key);
    if (!token) {
      token = this.builder.addRow('StandAloneSig', { Signature: Uint8Array.from(bytes) });
      this.localSignatures.set(key, token);
    }
    return token;
  }
}
