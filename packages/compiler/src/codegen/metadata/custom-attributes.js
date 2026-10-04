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
 * Pseudo-custom attributes are not rows: the runtime reads them from flags and other tables. `[Serializable]` sets
 * the TypeDef flag; the others (StructLayout, DllImport, MethodImpl, ...) are skipped and listed as a limit.
 */
import { encodeCustomAttribute, TypeAttributes, token } from '@sharpforge/cil';
import { SymbolKind, TypeKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { MetadataEmitError, namespaceOf, definitionNameOf } from './type-tokens.js';
import { methodSignature, methodSymbolSignature } from './member-signatures.js';
import { tupleElementNamesOf } from '../../binder/tuples.js';

const ASSEMBLY_TOKEN = token(0x20, 1);
const TYPE_DEF_TABLE = 2;
const SERIALIZABLE = 'System.SerializableAttribute';
/** Attributes that are flags or rows of other tables, never CustomAttribute rows. */
const pseudoAttributes = new Set([
  SERIALIZABLE,
  'System.NonSerializedAttribute',
  'System.Runtime.InteropServices.StructLayoutAttribute',
  'System.Runtime.InteropServices.FieldOffsetAttribute',
  'System.Runtime.InteropServices.DllImportAttribute',
  'System.Runtime.InteropServices.MarshalAsAttribute',
  'System.Runtime.InteropServices.InAttribute',
  'System.Runtime.InteropServices.OutAttribute',
  'System.Runtime.InteropServices.OptionalAttribute',
  'System.Runtime.InteropServices.ComImportAttribute',
  'System.Runtime.InteropServices.PreserveSigAttribute',
  'System.Runtime.CompilerServices.MethodImplAttribute',
  'System.Runtime.CompilerServices.SpecialNameAttribute',
]);
const REQUIRED_MEMBER = 'System.Runtime.CompilerServices.RequiredMemberAttribute';
const EXTENSION = 'System.Runtime.CompilerServices.ExtensionAttribute';
const SETS_REQUIRED_MEMBERS = 'System.Diagnostics.CodeAnalysis.SetsRequiredMembersAttribute';
const REQUIRED_MEMBERS_MESSAGE = 'Constructors of types with required members are not supported in this version of your compiler.';
const DEFAULT_LOCATIONS = Object.freeze({
  [SymbolKind.NamedType]: 'type',
  [SymbolKind.Method]: 'method',
  [SymbolKind.Property]: 'property',
  [SymbolKind.Field]: 'field',
  [SymbolKind.Event]: 'event',
  [SymbolKind.Parameter]: 'param',
});
const primitiveNames = Object.freeze({
  System_Boolean: 'bool', System_Char: 'char', System_SByte: 'sbyte', System_Byte: 'byte', System_Int16: 'short', System_UInt16: 'ushort',
  System_Int32: 'int', System_UInt32: 'uint', System_Int64: 'long', System_UInt64: 'ulong', System_Single: 'float', System_Double: 'double',
  System_String: 'string', System_Object: 'object',
});

/** The full metadata name of a type definition (`Namespace.Outer+Nested`). */
function fullNameOf(type) {
  const definition = type.originalDefinition ?? type;
  if (definition.containingType) return fullNameOf(definition.containingType) + '+' + definition.metadataName;
  if (definition.isFileLocal) return (namespaceOf(definition) ? namespaceOf(definition) + '.' : '') + definitionNameOf(definition);
  const namespace = namespaceOf(definition);
  return (namespace ? namespace + '.' : '') + definition.metadataName;
}

/**
 * The name a `typeof` argument is serialized as (II.23.3 SerString): the full name, with `[]` per array rank. A type of
 * this assembly or of the core library needs no assembly name; other shapes are refused rather than misnamed.
 */
function serializedTypeName(type) {
  if (type instanceof ArrayTypeSymbol) return serializedTypeName(type.elementType) + '[' + ','.repeat(type.rank - 1) + ']';
  const isPlainDefinition = type.kind === SymbolKind.NamedType && !type.arity && !(type.typeArguments?.length > 0);
  if (!isPlainDefinition) throw new MetadataEmitError(`typeof(${type.toDisplayString()}) in an attribute argument cannot be written`);
  return fullNameOf(type);
}

/** The type of an attribute parameter as `encodeCustomAttribute` describes it. */
function descriptorOf(type) {
  if (type instanceof ArrayTypeSymbol) return { kind: 'szarray', element: descriptorOf(type.elementType) };
  const primitive = primitiveNames[type.specialType];
  if (primitive) return primitive;
  if (type.typeKind === TypeKind.Enum) {
    return { kind: 'enum', name: fullNameOf(type), underlying: primitiveNames[type.enumUnderlyingType?.specialType] ?? 'int' };
  }
  if (fullNameOf(type) === 'System.Type') return 'System.Type';
  throw new MetadataEmitError(`an attribute argument of type '${type.toDisplayString()}' cannot be written`);
}

/** The value of a bound attribute argument in the shape its descriptor takes. */
function valueOf(expression, type) {
  if (expression.kind === 'TypeOf') return expression.operandType ? serializedTypeName(expression.operandType) : null;
  if (expression.kind === 'ArrayCreation') return (expression.elements ?? []).map(element => valueOf(element, type.elementType));
  const constant = expression.constantValue;
  if (constant) {
    const value = constant.isNull ? null : constant.value;
    // A value passed as `object` carries its own type.
    return type.specialType === 'System_Object' && value !== null ? { type: descriptorOf(expression.operand?.type ?? expression.type), value } : value;
  }
  if (expression.kind === 'Conversion' && expression.operand) return valueOf(expression.operand, type);
  throw new MetadataEmitError('an attribute argument that is not a constant, a typeof or an array of those cannot be written');
}

/**
 * The fixed argument values in parameter order. A `params` parameter given its elements one by one (the expanded
 * form) takes them as one array.
 */
function fixedValues(args, parameterTypes, hasParamsArray) {
  const last = parameterTypes.length - 1,
    isExpanded = hasParamsArray && (args.length !== parameterTypes.length || !(args[last].type instanceof ArrayTypeSymbol || args[last].constantValue?.isNull));
  if (!isExpanded) return args.map((argument, index) => valueOf(argument, parameterTypes[index]));
  const elementType = parameterTypes[last].elementType,
    fixed = args.slice(0, last).map((argument, index) => valueOf(argument, parameterTypes[index]));
  return [...fixed, args.slice(last).map(argument => valueOf(argument, elementType))];
}

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
  }
  write() {
    this.applied(ASSEMBLY_TOKEN, this.assembly, 'assembly');
    let declaresExtensions = false;
    for (const type of this.writer.types) {
      const plan = this.writer.plans.get(type),
        typeToken = this.writer.typeToken(type);
      if (plan.methods.some(method => method.symbol?.isExtensionMethod)) {
        this.wellKnown(typeToken, EXTENSION);
        declaresExtensions = true;
      }
      // Roslyn writes the attributes it synthesizes for a type before the ones the program applies.
      if (plan.properties.some(property => property.symbol.parameters.length)) this.defaultMember(typeToken, plan);
      this.applied(typeToken, type);
      const requiresMembers = declaresRequiredMember(type);
      if (requiresMembers) this.wellKnown(typeToken, REQUIRED_MEMBER);
      for (const field of plan.fields) {
        if (field.symbol) this.applied(field.token, field.symbol);
        if (field.symbol?.isRequired) this.wellKnown(field.token, REQUIRED_MEMBER);
        this.tupleElementNames(field.token, field.type);
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
      }
      for (const { symbol } of plan.events) this.applied(this.writer.eventTokens.get(symbol), symbol);
    }
    if (declaresExtensions) this.wellKnown(ASSEMBLY_TOKEN, EXTENSION);
  }
  method(planned) {
    const symbol = planned.symbol,
      owner = symbol?.associatedSymbol;
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
    const returnToken = this.writer.returnParameterTokens.get(symbol);
    if (returnToken) this.tupleElementNames(returnToken, symbol.returnType);
    for (const [index, parameter] of symbol.parameters.entries()) {
      const parameterToken = this.writer.parameterTokens.get(parameter);
      if (!parameterToken) continue;
      if (parameter.isParams) this.wellKnown(parameterToken, 'System.ParamArrayAttribute');
      this.tupleElementNames(parameterToken, parameter.type);
      this.applied(parameterToken, parameter);
      // The parameters of an indexer are declared once and repeated on each accessor.
      const declared = owner?.kind === SymbolKind.Property ? owner.parameters[index] : null;
      if (declared && declared !== parameter) this.applied(parameterToken, declared);
    }
  }
  /** The attributes the program wrote on `symbol` at its own location (`[A]`, not `[return: A]`). */
  applied(parent, symbol, location = DEFAULT_LOCATIONS[symbol.kind]) {
    for (const attribute of symbol.boundAttributes ?? []) {
      if (attribute.location !== location) continue;
      const name = fullNameOf(attribute.attributeClass);
      if (name === SERIALIZABLE && parent >>> 24 === TYPE_DEF_TABLE) {
        this.builder.rows[TYPE_DEF_TABLE][(parent & 0xffffff) - 1][0] |= TypeAttributes.Serializable;
      }
      if (pseudoAttributes.has(name)) continue;
      this.one(parent, attribute);
    }
  }
  one(parent, attribute) {
    const constructor = attribute.attributeConstructor,
      owner = this.types.typeToken(attribute.attributeClass);
    let parameterTypes, constructorToken;
    if (constructor) {
      const definition = constructor.originalDefinition ?? constructor;
      parameterTypes = definition.parameters.map(parameter => parameter.type);
      constructorToken = this.writer.methodTokens.get(definition) ?? this.builder.member(owner, '.ctor', methodSymbolSignature(this.types, definition));
    } else {
      // The registry lists no constructor for this framework attribute: the one that takes the arguments as written.
      parameterTypes = attribute.arguments.map(argument => argument.type);
      const shape = { isStatic: false, returnType: this.core.void, parameters: parameterTypes.map(type => ({ type })) };
      constructorToken = this.builder.member(owner, '.ctor', methodSignature(this.types, shape));
    }
    const values = fixedValues(attribute.arguments, parameterTypes, !!constructor?.parameters.at(-1)?.isParams),
      named = attribute.named.map(({ name, member, value }) => ({
        name,
        isField: member.kind === SymbolKind.Field,
        type: descriptorOf(member.type),
        value: valueOf(value, member.type),
      }));
    this.add(parent, constructorToken, encodeCustomAttribute(parameterTypes.map(descriptorOf), values, named));
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
  compilerGenerated(parent) {
    this.wellKnown(parent, 'System.Runtime.CompilerServices.CompilerGeneratedAttribute');
  }
  /** `[DefaultMember]` names the indexer, by the name its accessors have. */
  defaultMember(typeToken, plan) {
    const indexer = plan.properties.find(property => property.symbol.parameters.length),
      accessor = indexer.getter ?? indexer.setter;
    this.wellKnown(typeToken, 'System.Reflection.DefaultMemberAttribute', [accessor.name.slice(4)]);
  }
  add(parent, constructor, value) {
    this.builder.addRow('CustomAttribute', { Parent: parent, Type: constructor, Value: value });
  }
}
