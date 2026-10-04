/**
 * Metadata tables from source symbols (SF-A02-T29): the declarations of an analysed compilation written as ECMA-335
 * rows through the public metadata builder of `@sharpforge/cil`.
 *
 *   TypeDef            every source type with its namespace, flags and base type; NestedClass for nested types
 *   InterfaceImpl      the interfaces a type lists
 *   Field, Constant    declared and synthesized fields; the values of constants and enum members
 *   MethodDef, Param   declared and synthesized methods with their parameters
 *   PropertyMap, Property, EventMap, Event, MethodSemantics   properties, indexers and events with their accessors
 *   GenericParam, GenericParamConstraint                      type parameters of types and methods
 *   ClassLayout        size 1 for a struct without instance fields
 *
 * Tokens are fixed before the first signature is encoded: a TypeDef row lists its fields and methods as runs, so the
 * row order is the declaration order of the types (an enclosing type before the types nested in it).
 */
import { token, FieldAttributes } from '@sharpforge/cil';
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { TypeTokens, namespaceOf } from './type-tokens.js';
import { planMembers, explicitInterfaceOf } from './member-plan.js';
import { typeFlags, genericParameterFlags } from './attribute-flags.js';
import { tupleElementNamesOf } from './tuple-element-names.js';
import { fieldSignature, methodSignature, methodSymbolSignature, propertySignature } from './member-signatures.js';

const TABLE = Object.freeze({ TypeDef: 2, Field: 4, MethodDef: 6, Param: 8 });
const SEMANTICS = Object.freeze({ Setter: 1, Getter: 2, AddOn: 8, RemoveOn: 16 });
/** Constant.Type element types by the type discriminator of a compiler constant. */
const constantElementTypes = Object.freeze({
  bool: 2, char: 3, sbyte: 4, byte: 5, short: 6, ushort: 7, int: 8, uint: 9, long: 10, ulong: 11, float: 12, double: 13, string: 14,
});
const NULL_REFERENCE_CONSTANT = 28;
const LITERAL_FLAGS = FieldAttributes.Literal | FieldAttributes.HasDefault;

/** The Constant.Type of a compiler constant, or undefined when the table has no encoding for it. */
function constantTypeOf(constant) {
  if (constant.value === null || constant.isNull) return NULL_REFERENCE_CONSTANT;
  return constantElementTypes[constant.type];
}

/** Source type definitions in TypeDef order: declaration order, each enclosing type before its nested types. */
export function sourceTypesInMetadataOrder(assembly) {
  const ordered = [];
  const addType = type => {
    ordered.push(type);
    for (const nested of type.getTypeMembers()) addType(nested);
  };
  const addNamespace = namespace => {
    for (const member of namespace.getMembers()) {
      if (member.kind === SymbolKind.Namespace) addNamespace(member);
      else if (member.kind === SymbolKind.NamedType && member.isSource) addType(member);
    }
  };
  addNamespace(assembly.globalNamespace);
  return ordered;
}

export class SymbolMetadataWriter {
  /**
   * @param builder a MetadataBuilder  @param analysis a SemanticAnalysis that has run
   * @param {{bodyRva: number | ((method: object) => number), synthesized?: object}} options `bodyRva` is the RVA every
   *   method with a body points at, or a function of the planned method; `synthesized` (emit/cil/synthesized-members.js)
   *   adds what code generation declares: `types` appended after the source types and `extend(type, plan)`
   */
  constructor(builder, analysis, { bodyRva, synthesized = null }) {
    this.builder = builder;
    this.core = analysis.core;
    this.bodyRvaOf = typeof bodyRva === 'function' ? bodyRva : () => bodyRva;
    this.types = [...sourceTypesInMetadataOrder(analysis.assembly), ...(synthesized?.types ?? [])];
    this.tokens = new TypeTokens(builder, this.types);
    this.plans = new Map(this.types.map(type => [type, planMembers(type, this.core, field => analysis.constantOf(field))]));
    if (synthesized) for (const type of this.types) synthesized.extend(type, this.plans.get(type));
    /** Definition tokens by symbol, for callers that add rows of their own (custom attributes, method bodies). */
    this.fieldTokens = new Map();
    this.methodTokens = new Map();
    this.propertyTokens = new Map();
    this.eventTokens = new Map();
    this.parameterTokens = new Map();
    this.returnParameterTokens = new Map();
  }
  typeToken(type) {
    return this.tokens.definitionToken(type);
  }
  /** Writes every table; the builder can then be finished or extended by the caller. */
  write() {
    this.allocateTokens();
    this.writeTypeDefinitions();
    this.writeFields();
    this.writeMethods();
    for (const type of this.types) {
      this.writeTypeRelations(type);
      this.writeProperties(type);
      this.writeEvents(type);
    }
    return this;
  }
  allocateTokens() {
    let nextField = 1,
      nextMethod = 1;
    for (const type of this.types) {
      const plan = this.plans.get(type);
      plan.fieldStart = nextField;
      plan.methodStart = nextMethod;
      for (const field of plan.fields) {
        field.token = token(TABLE.Field, nextField++);
        if (field.symbol) this.fieldTokens.set(field.symbol, field.token);
      }
      for (const method of plan.methods) {
        method.token = token(TABLE.MethodDef, nextMethod++);
        if (method.symbol) this.methodTokens.set(method.symbol, method.token);
      }
    }
  }
  writeTypeDefinitions() {
    const builder = this.builder;
    builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
    for (const type of this.types) {
      const plan = this.plans.get(type),
        // A type initializer that only runs field initializers leaves the type `beforefieldinit`, as Roslyn does.
        hasStaticConstructor = plan.methods.some(method => method.name === '.cctor' && !method.isInitializerOnly),
        base = type.typeKind === TypeKind.Interface ? null : type.baseType;
      builder.addRow('TypeDef', {
        Flags: typeFlags(type, { hasStaticConstructor }),
        Name: type.metadataName,
        Namespace: namespaceOf(type),
        Extends: base ? this.tokens.typeToken(base) : 0,
        FieldList: plan.fieldStart,
        MethodList: plan.methodStart,
      });
    }
  }
  writeFields() {
    for (const type of this.types) {
      for (const field of this.plans.get(type).fields) {
        const constantType = field.constant ? constantTypeOf(field.constant) : undefined,
          isLiteral = !!(field.flags & FieldAttributes.Literal);
        // A constant the Constant table cannot hold (decimal) is a static readonly field set by its initializer.
        const unencodable = isLiteral && constantType === undefined,
          flags = unencodable ? (field.flags & ~LITERAL_FLAGS) | FieldAttributes.InitOnly : field.flags & ~FieldAttributes.HasDefault;
        this.builder.addRow('Field', { Flags: flags, Name: field.name, Signature: fieldSignature(this.tokens, field.type) });
        if (constantType === undefined) continue;
        const value = constantType === NULL_REFERENCE_CONSTANT ? null : field.constant.value;
        // The writer marks the field HasDefault.
        this.builder.definitions.constantValue({ Parent: field.token, Type: constantType, Value: value });
      }
    }
  }
  writeMethods() {
    let nextParameter = 1;
    for (const type of this.types) {
      for (const method of this.plans.get(type).methods) {
        const signature = method.symbol ? methodSymbolSignature(this.tokens, method.symbol) : methodSignature(this.tokens, method.shape);
        this.builder.addRow('MethodDef', {
          RVA: method.hasBody ? this.bodyRvaOf(method) : 0,
          ImplFlags: method.implFlags,
          Flags: method.flags,
          Name: method.name,
          Signature: signature,
          ParamList: nextParameter,
        });
        if (method.symbol && tupleElementNamesOf(method.symbol.returnType)) {
          // The return value has a Param row (sequence 0) only when an attribute is written on it.
          this.returnParameterTokens.set(method.symbol, this.builder.addRow('Param', { Flags: 0, Sequence: 0, Name: '' }));
          nextParameter++;
        }
        method.parameters.forEach((parameter, index) => {
          const row = this.builder.addRow('Param', { Flags: parameter.flags, Sequence: index + 1, Name: parameter.name ?? '' });
          if (method.symbol) this.parameterTokens.set(method.symbol.parameters[index], row);
          nextParameter++;
        });
      }
    }
  }
  /** InterfaceImpl, NestedClass, ClassLayout and the generic parameters of the type and of its methods. */
  writeTypeRelations(type) {
    const builder = this.builder,
      self = this.tokens.definitionToken(type),
      plan = this.plans.get(type);
    for (const implemented of type.interfaces ?? []) builder.addRow('InterfaceImpl', { Class: self, Interface: this.tokens.typeToken(implemented) });
    if (type.containingType) builder.addRow('NestedClass', { NestedClass: self, EnclosingClass: this.tokens.definitionToken(type.containingType) });
    const hasInstanceField = plan.fields.some(field => !(field.flags & FieldAttributes.Static));
    if (type.typeKind === TypeKind.Struct && !hasInstanceField) builder.addRow('ClassLayout', { PackingSize: 0, ClassSize: 1, Parent: self });
    this.writeGenericParameters(self, this.allTypeParameters(type));
    for (const method of plan.methods) {
      if (method.symbol?.typeParameters?.length) this.writeGenericParameters(method.token, method.symbol.typeParameters);
      // A synthesized method names the interface slots it fills: `{owner, name, shape}`.
      for (const slot of method.overrides ?? []) {
        const declaration = builder.member(this.tokens.typeToken(slot.owner), slot.name, methodSignature(this.tokens, slot.shape));
        builder.addRow('MethodImpl', { Class: self, MethodBody: method.token, MethodDeclaration: declaration });
      }
      if (!method.symbol || !explicitInterfaceOf(method.symbol)) continue;
      // An explicit implementation has a name of its own, so the slot it fills is stated by a MethodImpl row.
      for (const [declaration, implementation] of type.interfaceImplementations ?? []) {
        if (implementation !== method.symbol) continue;
        builder.addRow('MethodImpl', { Class: self, MethodBody: method.token, MethodDeclaration: this.methodReference(declaration) });
      }
    }
  }
  /** MethodDefOrRef token of a method declared here or elsewhere (a MemberRef on its containing type). */
  methodReference(method) {
    const definition = method.originalDefinition ?? method,
      defined = this.methodTokens.get(definition);
    if (defined) return defined;
    return this.builder.member(this.tokens.typeToken(method.containingType), definition.metadataName, methodSymbolSignature(this.tokens, definition));
  }
  /** The type parameters a TypeDef declares: those of its enclosing types first, as VAR numbers them. */
  allTypeParameters(type) {
    const outer = type.containingType ? this.allTypeParameters(type.containingType) : [];
    return [...outer, ...(type.typeParameters ?? [])];
  }
  writeGenericParameters(owner, parameters) {
    parameters.forEach((parameter, number) => {
      const row = this.builder.addRow('GenericParam', { Number: number, Flags: genericParameterFlags(parameter), Owner: owner, Name: parameter.name });
      // `struct` is also written as a constraint to System.ValueType, as Roslyn writes it.
      if (parameter.hasValueTypeConstraint || parameter.hasUnmanagedTypeConstraint) {
        this.builder.addRow('GenericParamConstraint', { Owner: row, Constraint: this.builder.typeRef('System.ValueType') });
      }
      for (const constraint of parameter.constraintTypes ?? []) {
        const type = constraint.type ?? constraint;
        if (type.specialType === 'System_Object') continue;
        this.builder.addRow('GenericParamConstraint', { Owner: row, Constraint: this.tokens.typeToken(type) });
      }
    });
  }
  writeProperties(type) {
    const properties = this.plans.get(type).properties;
    if (!properties.length) return;
    const builder = this.builder,
      first = (builder.rows[23]?.length ?? 0) + 1;
    builder.addRow('PropertyMap', { Parent: this.tokens.definitionToken(type), PropertyList: first });
    for (const { symbol, getter, setter } of properties) {
      // An indexer is named by its accessors (`Item`, or the name [IndexerName] gives).
      const accessor = getter ?? setter,
        name = symbol.parameters.length && accessor ? accessor.name.slice(4) : symbol.metadataName,
        row = builder.addRow('Property', { Flags: 0, Name: name, Type: propertySignature(this.tokens, symbol) });
      this.propertyTokens.set(symbol, row);
      if (getter) builder.addRow('MethodSemantics', { Semantics: SEMANTICS.Getter, Method: getter.token, Association: row });
      if (setter) builder.addRow('MethodSemantics', { Semantics: SEMANTICS.Setter, Method: setter.token, Association: row });
    }
  }
  writeEvents(type) {
    const events = this.plans.get(type).events;
    if (!events.length) return;
    const builder = this.builder,
      first = (builder.rows[20]?.length ?? 0) + 1;
    builder.addRow('EventMap', { Parent: this.tokens.definitionToken(type), EventList: first });
    for (const { symbol, adder, remover } of events) {
      const row = builder.addRow('Event', { EventFlags: 0, Name: symbol.name, EventType: this.tokens.typeToken(symbol.type) });
      this.eventTokens.set(symbol, row);
      builder.addRow('MethodSemantics', { Semantics: SEMANTICS.AddOn, Method: adder.token, Association: row });
      builder.addRow('MethodSemantics', { Semantics: SEMANTICS.RemoveOn, Method: remover.token, Association: row });
    }
  }
}
