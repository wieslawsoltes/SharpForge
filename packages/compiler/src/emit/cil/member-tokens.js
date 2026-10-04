/**
 * Metadata tokens for the operands of instructions (SF-A02-T30): types, methods, fields, string literals and local
 * variable signatures.
 *
 * A member the compilation defines is its definition token; anything else is a MemberRef on the TypeRef or TypeSpec
 * of its containing type, with the signature of the member's original definition (so a member of `List<int>` is named
 * with `!0`, as ECMA-335 II.22.25 requires). A constructed generic method is a MethodSpec over either.
 */
import { compressUnsigned, methodSpecBlob, needsMethodSpec, needsTypeSpec } from '../../codegen/generics.js';
import { SymbolKind, NamedTypeSymbol, substituteType } from '../../symbols/types.js';
import { declaringInterfaceOf } from './framework-declarations.js';
import { fieldSignature, methodSignature, methodSymbolSignature } from '../../codegen/metadata/member-signatures.js';

const LOCAL_SIGNATURE = 0x07;
const BY_REFERENCE = 0x10;
const PINNED = 0x45;
const USER_STRING = 0x70000000;
const GENERIC_METHOD = 0x10;
const GENERIC_INSTANTIATION = 0x0a;
const SZ_ARRAY = 0x1d;
const METHOD_TYPE_PARAMETER = 0x1e;

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
    this.typeSpecs = new Map();
    this.methodSpecs = new Map();
    this.localSignatures = new Map();
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
      defined = this.writer.methodTokens.get(definition);
    const parent = defined && !isInstantiation(owner) ? defined : this.memberReference(owner, definition);
    if (!needsMethodSpec(method)) return parent;
    const instantiation = methodSpecBlob(method, this.types.tokenOf),
      key = parent + ':' + instantiation.join(',');
    let token = this.methodSpecs.get(key);
    if (!token) {
      token = this.builder.addRow('MethodSpec', { Method: parent, Instantiation: Uint8Array.from(instantiation) });
      this.methodSpecs.set(key, token);
    }
    return token;
  }
  memberReference(owner, definition) {
    const declaringType = declaringInterfaceOf(this.writer.core, owner, definition.name),
      declaration = openDeclarationOf(declaringType, definition);
    return this.builder.member(this.type(declaringType), declaration.metadataName, methodSymbolSignature(this.types, declaration));
  }
  /** Field or MemberRef token of a field. */
  field(field) {
    const definition = field.originalDefinition ?? field,
      owner = field.containingType,
      defined = this.writer.fieldTokens.get(definition);
    if (defined && !isInstantiation(owner)) return defined;
    return this.builder.member(this.type(owner), definition.name, fieldSignature(this.types, definition.type));
  }
  /**
   * MemberRef token of a framework method named by its signature rather than by a symbol (the members lowering needs
   * that the symbol table does not model, such as `String.Concat(object, object)`).
   * @param owner the type symbol that declares it
   * @param {{isStatic: boolean, returnType: object, parameters: {type: object, refKind?: string}[]}} shape
   */
  external(owner, name, shape) {
    return this.builder.member(this.type(owner), name, methodSignature(this.types, shape));
  }
  /**
   * MethodSpec token of `RuntimeHelpers.GetSubArray<T>(T[], Range)` for an element type: the generic framework
   * method behind `array[range]`, which the symbol table does not model.
   */
  subArrayMethod(elementType, rangeType) {
    const owner = this.builder.typeRef('System.Runtime.CompilerServices.RuntimeHelpers'),
      vector = [SZ_ARRAY, METHOD_TYPE_PARAMETER, 0],
      signature = Uint8Array.from([GENERIC_METHOD, 1, 2, ...vector, ...vector, ...this.types.signature(rangeType)]),
      parent = this.builder.member(owner, 'GetSubArray', signature),
      instantiation = [GENERIC_INSTANTIATION, 1, ...this.types.signature(elementType)],
      key = parent + ':' + instantiation.join(',');
    let token = this.methodSpecs.get(key);
    if (!token) {
      token = this.builder.addRow('MethodSpec', { Method: parent, Instantiation: Uint8Array.from(instantiation) });
      this.methodSpecs.set(key, token);
    }
    return token;
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
    if (!planned || needsTypeSpec(event.containingType)) return null;
    return (isAdd ? planned.adder : planned.remover).token;
  }
  /** The token of the delegate field of a field-like source event, or null when the event has none. */
  eventField(event) {
    const definition = event.originalDefinition ?? event,
      plan = this.writer.plans.get(definition.containingType),
      field = plan?.fields.find(entry => !entry.symbol && entry.name === definition.name);
    return field && !needsTypeSpec(event.containingType) ? field.token : null;
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
