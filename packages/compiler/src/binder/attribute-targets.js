/**
 * Where an attribute list applies (SF-A02-T41, C# spec 22.3): the locations a declaration offers (`[return: A]`,
 * `[field: A]`, ...), the default one, and the System.AttributeTargets value each location stands for on that
 * declaration. Pure tables and functions over symbols; the binding itself is in ./attributes.js.
 */
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { AttributeTargets } from '../symbols/attribute-types.js';

const typeTargets = {
  [TypeKind.Class]: AttributeTargets.Class,
  [TypeKind.Struct]: AttributeTargets.Struct,
  [TypeKind.Enum]: AttributeTargets.Enum,
  [TypeKind.Interface]: AttributeTargets.Interface,
  [TypeKind.Delegate]: AttributeTargets.Delegate,
};

/** The words of CS0592, in the order of the AttributeTargets values. */
const targetWords = [
  [AttributeTargets.Assembly, 'assembly'],
  [AttributeTargets.Module, 'module'],
  [AttributeTargets.Class, 'class'],
  [AttributeTargets.Struct, 'struct'],
  [AttributeTargets.Enum, 'enum'],
  [AttributeTargets.Constructor, 'constructor'],
  [AttributeTargets.Method, 'method'],
  [AttributeTargets.Property, 'property, indexer'],
  [AttributeTargets.Field, 'field'],
  [AttributeTargets.Event, 'event'],
  [AttributeTargets.Interface, 'interface'],
  [AttributeTargets.Parameter, 'parameter'],
  [AttributeTargets.Delegate, 'delegate'],
  [AttributeTargets.ReturnValue, 'return'],
  [AttributeTargets.GenericParameter, 'type parameter'],
];

/** The declaration kinds a set of AttributeTargets names, as CS0592 lists them. */
export function describeTargets(validOn) {
  return targetWords
    .filter(([flag]) => validOn & flag)
    .map(([, word]) => word)
    .join(', ');
}

const methodTarget = method =>
  method.methodKind === MethodKind.Constructor || method.methodKind === MethodKind.StaticConstructor
    ? AttributeTargets.Constructor
    : AttributeTargets.Method;

/**
 * The attribute locations of a declared symbol: `{ default, targets: { location: AttributeTargets value } }`.
 * A location that is listed takes the attributes of a list with that specifier; any other specifier is CS0657.
 */
export function attributeLocations(symbol) {
  switch (symbol.kind) {
    case SymbolKind.NamedType: {
      const targets = { type: typeTargets[symbol.typeKind] ?? AttributeTargets.Class };
      if (symbol.typeKind === TypeKind.Delegate) targets.return = AttributeTargets.ReturnValue;
      return { default: 'type', targets };
    }
    case SymbolKind.Method: {
      const targets = { method: methodTarget(symbol) },
        kind = symbol.methodKind;
      const isSetter = kind === MethodKind.PropertySet || kind === MethodKind.EventAdd || kind === MethodKind.EventRemove;
      if (isSetter) targets.param = AttributeTargets.Parameter;
      if (!symbol.isConstructor && kind !== MethodKind.Destructor) targets.return = AttributeTargets.ReturnValue;
      return { default: 'method', targets };
    }
    case SymbolKind.Property: {
      const targets = { property: AttributeTargets.Property };
      if (symbol.isAutoProperty) targets.field = AttributeTargets.Field;
      return { default: 'property', targets };
    }
    case SymbolKind.Field:
      return { default: 'field', targets: { field: AttributeTargets.Field } };
    case SymbolKind.Event: {
      const targets = { event: AttributeTargets.Event };
      if (symbol.isFieldLike) {
        targets.field = AttributeTargets.Field;
        targets.method = AttributeTargets.Method;
      }
      return { default: 'event', targets };
    }
    case SymbolKind.Parameter:
      return { default: 'param', targets: { param: AttributeTargets.Parameter } };
    case SymbolKind.TypeParameter:
      return { default: 'typevar', targets: { typevar: AttributeTargets.GenericParameter } };
    default:
      return { default: null, targets: {} };
  }
}

/** The locations of the attribute lists of a compilation unit. */
export const compilationLocations = Object.freeze({
  default: null,
  targets: Object.freeze({ assembly: AttributeTargets.Assembly, module: AttributeTargets.Module }),
});

/** Every location specifier the language defines; another identifier before the colon is CS0658. */
export const knownLocations = new Set(['assembly', 'module', 'type', 'method', 'return', 'param', 'property', 'field', 'event', 'typevar']);
