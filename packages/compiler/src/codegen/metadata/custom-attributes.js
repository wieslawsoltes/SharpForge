/**
 * CustomAttribute rows from bound attributes (SF-A02-T41, SF-A02-T29).
 *
 * An attribute the program applies is written as: Parent (the declaration's token), Type (the attribute constructor: a
 * MethodDef for a source attribute class, else a MemberRef on its TypeRef) and Value (ECMA-335 II.23.3, encoded by
 * `encodeCustomAttribute` of `@sharpforge/cil` from the bound arguments).
 *
 * Attributes the language adds itself are written the same way through `wellKnown`:
 *   DefaultMemberAttribute("Item")   on a type that declares an indexer
 *   ParamArrayAttribute              on a `params` parameter
 *   ExtensionAttribute               on an extension method, on its class and on the assembly
 *   CompilerGeneratedAttribute       on the backing fields and accessors of auto-properties and field-like events,
 *                                    and on the members a record synthesizes
 *   TupleElementNamesAttribute       on a field, parameter, return value or property whose type names tuple elements
 *   RequiredMemberAttribute          on a `required` member and its type; Obsolete + CompilerFeatureRequired on the
 *                                    constructors of such a type that are not marked [SetsRequiredMembers]
 *
 * Pseudo-custom attributes are written through `PseudoAttributeWriter`: CLI flags and layout, import and marshal
 * tables carry the contract the runtime reads.
 */
import { encodeCustomAttribute, token } from '@sharpforge/cil';
import { SymbolKind, RefKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { needsTypeSpec } from '../generics.js';
import { fullNameOf, serializedTypeName } from './serialized-type-names.js';
import { descriptorOf, valueOf, fixedValues } from './attribute-values.js';
import { returnAttributeSymbols, returnAttributeSource } from './attribute-targets.js';
import { methodSignature, methodSymbolSignature } from './member-signatures.js';
import { tupleElementNamesOf } from '../../binder/tuples.js';
import { dynamicTransformFlags } from './dynamic-flags.js';
import { contractAssemblyOf } from './reference-contracts.js';
import { explicitInterfaceOf, metadataPropertyName } from './explicit-interface-names.js';
import { writeParameterAttributes } from './parameter-metadata.js';
import { fixedBufferTypeName } from './fixed-buffer-type-name.js';
import { PseudoAttributeWriter } from './pseudo-attributes.js';

const ASSEMBLY_TOKEN = token(0x20, 1);
const REQUIRED_MEMBER = 'System.Runtime.CompilerServices.RequiredMemberAttribute';
const IS_BY_REF_LIKE = 'System.Runtime.CompilerServices.IsByRefLikeAttribute';
const EXTENSION = 'System.Runtime.CompilerServices.ExtensionAttribute';
const UNSAFE_VALUE_TYPE = 'System.Runtime.CompilerServices.UnsafeValueTypeAttribute';
const FIXED_BUFFER = 'System.Runtime.CompilerServices.FixedBufferAttribute';
const DYNAMIC = 'System.Runtime.CompilerServices.DynamicAttribute';
const isByReference = refKind => !!refKind && refKind !== RefKind.None;
const SETS_REQUIRED_MEMBERS = 'System.Diagnostics.CodeAnalysis.SetsRequiredMembersAttribute';
const REQUIRED_MEMBERS_MESSAGE = 'Constructors of types with required members are not supported in this version of your compiler.';
const DEFAULT_LOCATIONS = Object.freeze({
  [SymbolKind.NamedType]: 'type',
  [SymbolKind.Method]: 'method',
  [SymbolKind.Property]: 'property',
  [SymbolKind.Field]: 'field',
  [SymbolKind.Event]: 'event',
  [SymbolKind.Parameter]: 'param',
  [SymbolKind.TypeParameter]: 'typevar',
});
const isRequiredMember = member => (member.kind === SymbolKind.Field || member.kind === SymbolKind.Property) && !!member.isRequired;
const declaresRequiredMember = type => type.getMembers().some(isRequiredMember);

/** True for an instance constructor of a type that has required members (its own or inherited) and does not set them. */
function isConstructorOfRequiredMembers(method) {
  if (!method || method.methodKind !== MethodKind.Constructor || method.isStatic) return false;
  if ((method.boundAttributes ?? []).some(attribute => fullNameOf(attribute.attributeClass) === SETS_REQUIRED_MEMBERS)) return false;
  for (let type = method.containingType; type?.isSource; type = type.baseType?.originalDefinition ?? type.baseType) {
    if (declaresRequiredMember(type)) return true;
  }
  return false;
}

export class CustomAttributeWriter {
  /** @param writer a SymbolMetadataWriter whose tables are written  @param analysis the SemanticAnalysis */
  constructor(writer, analysis) {
    this.writer = writer;
    this.builder = writer.builder;
    this.types = writer.tokens;
    this.assembly = analysis.assembly;
    this.core = analysis.core;
    this.pseudo = null;
  }
  write() {
    this.applied(ASSEMBLY_TOKEN, this.assembly, 'assembly');
    this.applied(token(0, 1), this.assembly, 'module');
    for (const row of this.writer.genericParameterRows) this.applied(row.token, row.symbol);
    let declaresExtensions = false;
    for (const type of this.writer.types) {
      const plan = this.writer.plans.get(type),
        typeToken = this.writer.typeToken(type);
      if (plan.methods.some(method => method.symbol?.isExtensionMethod)) {
        this.wellKnown(typeToken, EXTENSION);
        declaresExtensions = true;
      }
      // Roslyn writes the attributes it synthesizes for a type before the ones the program applies.
      this.defaultMember(typeToken, plan);
      // The runtime refuses a by-reference-like field (a `Span<T>`) in a struct that is not marked as a ref struct.
      if (type.isRefLikeType) this.wellKnown(typeToken, IS_BY_REF_LIKE);
      if (type.isFixedBufferType) {
        this.compilerGenerated(typeToken);
        this.wellKnown(typeToken, UNSAFE_VALUE_TYPE);
      }
      this.applied(typeToken, type);
      const requiresMembers = declaresRequiredMember(type);
      if (requiresMembers) this.wellKnown(typeToken, REQUIRED_MEMBER);
      for (const field of plan.fields) {
        if (field.symbol) this.applied(field.token, field.symbol);
        const associated = field.symbol?.associatedSymbol ?? field.associatedSymbol;
        if (associated) this.applied(field.token, associated, 'field');
        if (field.symbol?.isRequired) this.wellKnown(field.token, REQUIRED_MEMBER);
        if (field.fixedBuffer) this.fixedBuffer(field.token, field.fixedBuffer);
        this.tupleElementNames(field.token, field.type);
        if (field.symbol) this.dynamic(field.token, field.symbol.type);
        const isBackingField = field.symbol?.associatedSymbol?.kind === SymbolKind.Property;
        if (isBackingField || field.isCompilerGenerated) this.compilerGenerated(field.token);
      }
      for (const method of plan.methods) {
        this.method(method);
        if (isConstructorOfRequiredMembers(method.symbol)) this.requiredMembersConstructor(method.token);
      }
      for (const { symbol } of plan.properties) {
        this.applied(this.writer.propertyTokens.get(symbol), symbol);
        if (symbol.isRequired) this.wellKnown(this.writer.propertyTokens.get(symbol), REQUIRED_MEMBER);
        if (symbol.isSynthesizedRecordMember) this.compilerGenerated(this.writer.propertyTokens.get(symbol));
        this.tupleElementNames(this.writer.propertyTokens.get(symbol), symbol.type);
        this.dynamic(this.writer.propertyTokens.get(symbol), symbol.type);
      }
      for (const { symbol } of plan.events) this.applied(this.writer.eventTokens.get(symbol), symbol);
    }
    if (declaresExtensions) this.wellKnown(ASSEMBLY_TOKEN, EXTENSION);
  }
  method(planned) {
    const symbol = planned.symbol,
      owner = symbol?.associatedSymbol;
    if (planned.associatedSymbol) this.applied(planned.token, planned.associatedSymbol, 'method');
    const returnToken = planned.returnParameterToken, returnSource = returnAttributeSource(planned);
    if (returnToken && returnSource) {
      for (const declaration of returnAttributeSymbols(returnSource)) this.applied(returnToken, declaration, 'return');
      this.tupleElementNames(returnToken, returnSource.returnType);
      this.dynamic(returnToken, returnSource.returnType, isByReference(returnSource.refKind));
    }
    if (!symbol) {
      // A synthesized accessor of a field-like event (delegate members are runtime-implemented and carry nothing).
      if (planned.isCompilerGenerated) this.compilerGenerated(planned.token);
      return;
    }
    this.applied(planned.token, symbol);
    if (symbol.isExtensionMethod) this.wellKnown(planned.token, EXTENSION);
    if (planned.overrides) this.wellKnown(planned.token, 'System.Runtime.CompilerServices.PreserveBaseOverridesAttribute');
    if (owner?.kind === SymbolKind.Property && owner.isAutoProperty) this.compilerGenerated(planned.token);
    // The members a record synthesizes, its copy constructor included.
    if (symbol.recordMember || (symbol.isCopyConstructor && symbol.isImplicitlyDeclared)) this.compilerGenerated(planned.token);
    for (const [index, parameter] of symbol.parameters.entries()) {
      const parameterToken = planned.parameterTokens[index];
      if (!parameterToken) continue;
      writeParameterAttributes(this, parameterToken, parameter);
      this.tupleElementNames(parameterToken, parameter.type);
      this.dynamic(parameterToken, parameter.type, isByReference(parameter.refKind));
      this.applied(parameterToken, parameter);
      if (index === symbol.parameters.length - 1) this.applied(parameterToken, symbol, 'param');
      // The parameters of an indexer are declared once and repeated on each accessor.
      const declared = owner?.kind === SymbolKind.Property ? owner.parameters[index] : null;
      if (declared && declared !== parameter) this.applied(parameterToken, declared);
    }
  }
  /** The attributes the program wrote on `symbol` at its own location (`[A]`, not `[return: A]`). */
  applied(parent, symbol, location = DEFAULT_LOCATIONS[symbol.kind]) {
    for (const attribute of symbol.boundAttributes ?? []) {
      if (attribute.location !== location) continue;
      this.pseudo ??= new PseudoAttributeWriter(this);
      if (this.pseudo.apply(parent, attribute, symbol)) continue;
      this.one(parent, attribute);
    }
  }
  one(parent, attribute) {
    const constructor = attribute.attributeConstructor,
      owner = this.types.typeToken(attribute.attributeClass);
    let parameterTypes, constructorToken;
    if (constructor) {
      const definition = constructor.originalDefinition ?? constructor,
        // A constructed attribute class (C# 11 `[My<int>]`): the constructor is named on the TypeSpec with the
        // signature of its definition (`!0`), and the argument is encoded as the type the construction gives it.
        isConstructed = needsTypeSpec(attribute.attributeClass),
        defined = isConstructed ? undefined : this.writer.methodTokens.get(definition);
      parameterTypes = (isConstructed ? constructor : definition).parameters.map(parameter => parameter.type);
      constructorToken = defined ?? this.builder.member(owner, '.ctor', methodSymbolSignature(this.types, definition));
    } else {
      // The registry lists no constructor for this framework attribute: the one that takes the arguments as written.
      parameterTypes = attribute.arguments.map(argument => argument.type);
      const shape = { isStatic: false, returnType: this.core.void, parameters: parameterTypes.map(type => ({ type })) };
      constructorToken = this.builder.member(owner, '.ctor', methodSignature(this.types, shape));
    }
    const values = fixedValues(attribute.arguments, parameterTypes, constructor?.parameters ?? null, this.types),
      named = attribute.named.map(({ name, member, value }) => ({
        name,
        isField: member.kind === SymbolKind.Field,
        type: descriptorOf(member.type, this.types),
        value: valueOf(value, member.type, this.types),
      }));
    this.add(parent, constructorToken, encodeCustomAttribute(parameterTypes.map(type => descriptorOf(type, this.types)), values, named));
  }
  /** An attribute of the framework with string arguments only, by its full metadata name. */
  wellKnown(parent, fullName, values = []) {
    const shape = { isStatic: false, returnType: this.core.void, parameters: values.map(() => ({ type: this.core.string })) },
      constructor = this.builder.member(this.builder.typeRef(fullName), '.ctor', methodSignature(this.types, shape));
    this.add(parent, constructor, encodeCustomAttribute(values.map(() => 'string'), values));
  }
  /**
   * A constructor of a type with required members that does not set them all: a compiler that does not know the
   * feature must not call it (`[Obsolete(.., error: true)]`, `[CompilerFeatureRequired("RequiredMembers")]`).
   */
  requiredMembersConstructor(parent) {
    const shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: this.core.string }, { type: this.core.bool }] },
      obsolete = this.builder.member(this.builder.typeRef('System.ObsoleteAttribute'), '.ctor', methodSignature(this.types, shape));
    this.add(parent, obsolete, encodeCustomAttribute(['string', 'bool'], [REQUIRED_MEMBERS_MESSAGE, true]));
    this.wellKnown(parent, 'System.Runtime.CompilerServices.CompilerFeatureRequiredAttribute', ['RequiredMembers']);
  }
  /** `[TupleElementNames]` on a declaration whose type names tuple elements; nothing for any other type. */
  tupleElementNames(parent, type) {
    const names = tupleElementNamesOf(type);
    if (!names) return;
    const strings = new ArrayTypeSymbol(this.core.string),
      shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: strings }] },
      owner = this.builder.typeRef('System.Runtime.CompilerServices.TupleElementNamesAttribute'),
      constructor = this.builder.member(owner, '.ctor', methodSignature(this.types, shape));
    this.add(parent, constructor, encodeCustomAttribute([{ kind: 'szarray', element: 'string' }], [names]));
  }
  /** `[FixedBuffer(typeof(T), length)]` on a fixed-size buffer field. */
  fixedBuffer(parent, { elementType, length }) {
    const shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: this.core.type }, { type: this.core.int }] },
      constructor = this.builder.member(this.builder.typeRef(FIXED_BUFFER), '.ctor', methodSignature(this.types, shape));
    const name = fixedBufferTypeName(this.types, elementType, serializedTypeName(elementType));
    this.add(parent, constructor, encodeCustomAttribute(['System.Type', 'int'], [name, length]));
  }
  /**
   * The TypeRef of a framework attribute that is not in the core library's contract: through the reference that
   * defines it, else through its contract assembly (reference-contracts.js).
   */
  frameworkAttribute(fullName) {
    const split = fullName.lastIndexOf('.'),
      assembly = this.types.assemblyOf({}, fullName) ?? contractAssemblyOf(fullName.slice(0, split), fullName.slice(split + 1));
    return this.builder.typeRef(fullName, assembly);
  }
  /** `[Dynamic]` on a declaration whose type mentions `dynamic`; nothing for any other type (dynamic-flags.js). */
  dynamic(parent, type, isByReferenceSlot = false) {
    const flags = dynamicTransformFlags(type, isByReferenceSlot);
    if (!flags) return;
    const isPlain = flags.length === 1,
      shape = { isStatic: false, returnType: this.core.void, parameters: isPlain ? [] : [{ type: new ArrayTypeSymbol(this.core.bool) }] },
      constructor = this.builder.member(this.frameworkAttribute(DYNAMIC), '.ctor', methodSignature(this.types, shape));
    if (isPlain) return void this.add(parent, constructor, encodeCustomAttribute([], []));
    this.add(parent, constructor, encodeCustomAttribute([{ kind: 'szarray', element: 'bool' }], [flags]));
  }
  compilerGenerated(parent) {
    this.wellKnown(parent, 'System.Runtime.CompilerServices.CompilerGeneratedAttribute');
  }
  /** `[DefaultMember]` names the indexer, by the name its accessors have. */
  defaultMember(typeToken, plan) {
    const indexer = plan.properties.find(property => property.symbol.parameters.length && !explicitInterfaceOf(property.symbol));
    if (!indexer) return;
    const name = metadataPropertyName(indexer.symbol, indexer.getter ?? indexer.setter);
    this.wellKnown(typeToken, 'System.Reflection.DefaultMemberAttribute', [name]);
  }
  add(parent, constructor, value) {
    this.builder.addRow('CustomAttribute', { Parent: parent, Type: constructor, Value: value });
  }
}
