/**
 * The attribute classes of the base class library that C# 1 and 2 programs apply, for compilations bound against the
 * closed framework registry (SF-A02-T41). The registry lists `System.Attribute` and nothing else; attributes are bound
 * to symbols, so the classes the compiler itself interprets (AttributeUsage, Obsolete, Conditional, Flags, DllImport)
 * and the common marker attributes need a constructor list, their named arguments and their declared usage.
 *
 * Nothing here executes: an attribute is metadata. A class that is not listed is a framework gap, as everywhere else.
 */
import { NamedTypeSymbol, TypeKind, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, FieldSymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';
import { ConstantValue } from '../constants/constant-value.js';
import { modernAttributes } from './attribute-types-modern.js';

/** The values of System.AttributeTargets. */
export const AttributeTargets = Object.freeze({
  Assembly: 1,
  Module: 2,
  Class: 4,
  Struct: 8,
  Enum: 16,
  Constructor: 32,
  Method: 64,
  Property: 128,
  Field: 256,
  Event: 512,
  Interface: 1024,
  Parameter: 2048,
  Delegate: 4096,
  ReturnValue: 8192,
  GenericParameter: 16384,
  All: 32767,
});

const T = AttributeTargets;
const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

/** [namespace, name, members]. Enum members are [name, value]. */
const enums = [
  ['System', 'AttributeTargets', Object.entries(AttributeTargets)],
  ['System.Runtime.InteropServices', 'CharSet', [['None', 1], ['Ansi', 2], ['Unicode', 3], ['Auto', 4]]],
  ['System.Runtime.InteropServices', 'CallingConvention', [['Winapi', 1], ['Cdecl', 2], ['StdCall', 3], ['ThisCall', 4], ['FastCall', 5]]],
  ['System.Runtime.InteropServices', 'LayoutKind', [['Sequential', 0], ['Explicit', 2], ['Auto', 3]]],
];

const interop = 'System.Runtime.InteropServices',
  diagnostics = 'System.Diagnostics';
const types = T.Class | T.Struct | T.Enum | T.Interface | T.Delegate;

/**
 * [namespace, name, valid targets, allow multiple, constructors, named arguments]. A constructor is a list of
 * [parameter name, type key]; a named argument is [name, type key, 'field' | 'property']. Type keys: `s` string,
 * `b` bool, `i` int, `t` System.Type, otherwise the name of an enum of the table above.
 */
const attributes = [
  ['System', 'AttributeUsageAttribute', T.Class, false, [[['validOn', 'AttributeTargets']]], [['AllowMultiple', 'b'], ['Inherited', 'b']]],
  ['System', 'ObsoleteAttribute', T.All & ~(T.Assembly | T.Module | T.Parameter | T.ReturnValue | T.GenericParameter), false,
    [[], [['message', 's']], [['message', 's'], ['error', 'b']]], [['DiagnosticId', 's'], ['UrlFormat', 's']]],
  ['System', 'FlagsAttribute', T.Enum, false, [[]], []],
  ['System', 'SerializableAttribute', T.Class | T.Struct | T.Enum | T.Delegate, false, [[]], []],
  ['System', 'NonSerializedAttribute', T.Field, false, [[]], []],
  ['System', 'STAThreadAttribute', T.Method, false, [[]], []],
  ['System', 'MTAThreadAttribute', T.Method, false, [[]], []],
  ['System', 'ThreadStaticAttribute', T.Field, false, [[]], []],
  ['System', 'CLSCompliantAttribute', T.All, false, [[['isCompliant', 'b']]], []],
  ['System', 'ParamArrayAttribute', T.Parameter, false, [[]], []],
  [diagnostics, 'ConditionalAttribute', T.Class | T.Method, true, [[['conditionString', 's']]], []],
  [diagnostics, 'DebuggerStepThroughAttribute', T.Class | T.Struct | T.Constructor | T.Method, false, [[]], []],
  [diagnostics, 'DebuggerHiddenAttribute', T.Constructor | T.Method | T.Property, false, [[]], []],
  [diagnostics, 'DebuggerNonUserCodeAttribute', T.Class | T.Struct | T.Constructor | T.Method | T.Property, false, [[]], []],
  [diagnostics, 'DebuggerDisplayAttribute', types | T.Assembly | T.Property | T.Field, true, [[['value', 's']]],
    [['Name', 's'], ['Type', 's'], ['TargetTypeName', 's'], ['Target', 't']]],
  [interop, 'DllImportAttribute', T.Method, false, [[['dllName', 's']]],
    [['EntryPoint', 's', 'field'], ['CharSet', 'CharSet', 'field'], ['SetLastError', 'b', 'field'], ['ExactSpelling', 'b', 'field'],
      ['PreserveSig', 'b', 'field'], ['CallingConvention', 'CallingConvention', 'field'], ['BestFitMapping', 'b', 'field'],
      ['ThrowOnUnmappableChar', 'b', 'field']]],
  [interop, 'StructLayoutAttribute', T.Class | T.Struct, false, [[['layoutKind', 'LayoutKind']]],
    [['Pack', 'i', 'field'], ['Size', 'i', 'field'], ['CharSet', 'CharSet', 'field']]],
  [interop, 'FieldOffsetAttribute', T.Field, false, [[['offset', 'i']]], []],
  [interop, 'InAttribute', T.Parameter, false, [[]], []],
  [interop, 'OutAttribute', T.Parameter, false, [[]], []],
  [interop, 'ComVisibleAttribute', types | T.Assembly | T.Method | T.Property | T.Field, false, [[['visibility', 'b']]], []],
  [interop, 'GuidAttribute', types | T.Assembly, false, [[['guid', 's']]], []],
  [interop, 'ComImportAttribute', T.Class | T.Interface, false, [[]], []],
  [interop, 'CoClassAttribute', T.Interface, false, [[['coClass', 't']]], []],
  ['System.Runtime.CompilerServices', 'CompilerGeneratedAttribute', T.All, false, [[]], []],
  ['System.Runtime.CompilerServices', 'ReferenceAssemblyAttribute', T.Assembly, false, [[]], []],
  ['System.Runtime.CompilerServices', 'InternalsVisibleToAttribute', T.Assembly, true, [[['assemblyName', 's']]], []],
  // The metadata name of an indexer (binder/members/indexer-names.js decodes it).
  ['System.Runtime.CompilerServices', 'IndexerNameAttribute', T.Property, false, [[['indexerName', 's']]], []],
  // Caller info (binder/caller-info.js decodes them).
  ['System.Runtime.CompilerServices', 'CallerMemberNameAttribute', T.Parameter, false, [[]], []],
  ['System.Runtime.CompilerServices', 'CallerFilePathAttribute', T.Parameter, false, [[]], []],
  ['System.Runtime.CompilerServices', 'CallerLineNumberAttribute', T.Parameter, false, [[]], []],
  ['System.Runtime.CompilerServices', 'CallerArgumentExpressionAttribute', T.Parameter, false, [[['parameterName', 's']]], []],
  ['System.Reflection', 'AssemblyTitleAttribute', T.Assembly, false, [[['title', 's']]], []],
  ['System.Reflection', 'AssemblyVersionAttribute', T.Assembly, false, [[['version', 's']]], []],
  ['System.Reflection', 'AssemblyDescriptionAttribute', T.Assembly, false, [[['description', 's']]], []],
  ['System.Reflection', 'AssemblyCompanyAttribute', T.Assembly, false, [[['company', 's']]], []],
  ['System.Reflection', 'AssemblyProductAttribute', T.Assembly, false, [[['product', 's']]], []],
  ['System.Reflection', 'AssemblyCopyrightAttribute', T.Assembly, false, [[['copyright', 's']]], []],
];

function declareEnum(container, name, members, core) {
  let type = container.getTypeMembers(name, 0)[0];
  if (type) return type;
  type = container.addType(
    new NamedTypeSymbol({ name, typeKind: TypeKind.Enum, isSealed: true, baseType: () => core.enumType, enumUnderlyingType: core.int }),
  );
  for (const [memberName, value] of members) {
    const field = new FieldSymbol({
      ...publicMember,
      name: memberName,
      type,
      modifiers: DeclarationModifiers.Const | DeclarationModifiers.Static,
      constantValue: { value: null },
    });
    field.isEnumMember = true;
    field.enumValue = BigInt(value);
    field.constantValue = ConstantValue.integral('int', field.enumValue, type);
    type.addMember(field);
  }
  return type;
}

function addNamedArgument(type, name, memberType, kind, core) {
  if (type.getMembers(name).length) return;
  if (kind === 'field') {
    type.addMember(new FieldSymbol({ ...publicMember, name, type: memberType }));
    return;
  }
  const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: memberType });
  const setMethod = new MethodSymbol({
    ...publicMember,
    name: 'set_' + name,
    methodKind: MethodKind.PropertySet,
    returnType: core.void,
    parameters: [new ParameterSymbol({ name: 'value', type: memberType })],
  });
  type.addMember(getMethod);
  type.addMember(setMethod);
  type.addMember(new PropertySymbol({ ...publicMember, name, type: memberType, getMethod, setMethod }));
}

/**
 * Declares the attribute classes once per bridge. A compilation with a referenced core library reads them, and their
 * AttributeUsage, from metadata instead.
 */
export function declareAttributeTypes(core) {
  if (core.bridge.assembly || !core.attribute || core.attribute.isErrorType()) return;
  const bridge = core.bridge.bridge ?? core.bridge;
  if (bridge.attributeTypesDeclared) return;
  bridge.attributeTypesDeclared = true;
  const typeOf = { s: core.string, b: core.bool, i: core.int, t: core.type };
  for (const [namespaceName, name, members] of enums)
    typeOf[name] = declareEnum(bridge.globalNamespace.ensureNamespace(namespaceName), name, members, core);
  if (!core.attribute.getMembers('.ctor').length)
    core.attribute.addMember(
      new MethodSymbol({
        name: '.ctor',
        methodKind: MethodKind.Constructor,
        returnType: core.void,
        parameters: [],
        declaredAccessibility: Accessibility.Protected,
        isImplicitlyDeclared: true,
      }),
    );
  core.attribute.isAbstract = true;
  for (const [namespaceName, name, validOn, allowMultiple, constructors, named] of [...attributes, ...modernAttributes(T)]) {
    const container = bridge.globalNamespace.ensureNamespace(namespaceName);
    let type = container.getTypeMembers(name, 0)[0];
    if (type) type._base = core.attribute;
    else type = container.addType(new NamedTypeSymbol({ name, isSealed: true, baseType: core.attribute }));
    type.attributeUsage = Object.freeze({ validOn, allowMultiple, inherited: true });
    for (const shape of constructors) {
      const parameters = shape.map(([parameterName, key], ordinal) => new ParameterSymbol({ name: parameterName, type: typeOf[key], ordinal }));
      if (type.getMembers('.ctor').some(existing => existing.parameters.length === parameters.length)) continue;
      type.addMember(new MethodSymbol({ ...publicMember, name: '.ctor', methodKind: MethodKind.Constructor, returnType: core.void, parameters }));
    }
    for (const [memberName, key, kind = 'property'] of named) addNamedArgument(type, memberName, typeOf[key], kind, core);
  }
}
