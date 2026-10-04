import {declareVarargsTypes} from './varargs-types.js';
/**
 * The predefined types the type-system modules reason about, resolved once against the core library of a compilation
 * (the framework registry bridge): `core.int`, `core.object`, `core.nullableOf(T)`, `core.keyword('ulong')`...
 * `nint`/`nuint` are IntPtr/UIntPtr flagged as native integers, so they are distinct from the plain structs until
 * C# 11 identity is asked for (conversions/native-int.js).
 */
import { ConstructedNamedTypeSymbol, ArrayTypeSymbol, TypeWithAnnotations, TypeKind } from './types.js';
import { frameworkBridge } from './registry-bridge.js';
import { specialTypeFromKeyword } from './special-types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';
import { Accessibility } from './types.js';
import { declareSpanTypes } from './span-types.js';
import { declareIndexRangeTypes } from './index-range-types.js';
import { declareAsyncEnumeration } from './async-enumeration.js';
import { declareAwaiterTypes } from './awaiter-types.js';
import { declareFormattableTypes } from './formattable-types.js';
import { declareExpressionTreeTypes } from './expression-tree-types.js';
import { declareCoreTypeRelations } from './core-type-relations.js';
import { declareExceptionTypes } from './exception-types.js';
import { declareAttributeTypes } from './attribute-types.js';
import { declareArrayMembers } from './array-members.js';
import { declareComparisonInterfaces } from './comparison-interfaces.js';
import { declareNumericConstants } from './numeric-constants.js';

const keywordNames = [
  'object',
  'void',
  'bool',
  'char',
  'sbyte',
  'byte',
  'short',
  'ushort',
  'int',
  'uint',
  'long',
  'ulong',
  'decimal',
  'float',
  'double',
  'string',
];
export class CoreTypes {
  constructor(bridge = frameworkBridge()) {
    this.bridge = bridge;
    this.byKeyword = new Map();
    this.arrays = new Map();
    for (const k of keywordNames) {
      const type = bridge.coreType(specialTypeFromKeyword(k));
      this[k] = type;
      this.byKeyword.set(k, type);
    }
    const native = (id, keyword) => {
      const def = bridge.coreType(id),
        type = new ConstructedNamedTypeSymbol(def, [], null);
      type.isNativeInteger = true;
      this[keyword] = type;
      this.byKeyword.set(keyword, type);
    };
    native('System_IntPtr', 'nint');
    native('System_UIntPtr', 'nuint');
    this.intPtr = bridge.coreType('System_IntPtr');
    this.uintPtr = bridge.coreType('System_UIntPtr');
    this.valueType = bridge.coreType('System_ValueType');
    this.enumType = bridge.coreType('System_Enum');
    this.array = bridge.coreType('System_Array');
    this.delegate = bridge.coreType('System_Delegate');
    this.multicastDelegate = bridge.coreType('System_MulticastDelegate');
    this.exception = bridge.coreType('System_Exception');
    this.nullable = bridge.coreType('System_Nullable_T');
    this.idisposable = bridge.coreType('System_IDisposable');
    this.ienumerable = bridge.coreType('System_Collections_IEnumerable');
    this.ienumerableT = bridge.coreType('System_Collections_Generic_IEnumerable_T');
    this.ienumerator = bridge.coreType('System_Collections_IEnumerator');
    this.ienumeratorT = bridge.coreType('System_Collections_Generic_IEnumerator_T');
    this.ilistT = bridge.coreType('System_Collections_Generic_IList_T');
    this.icollectionT = bridge.coreType('System_Collections_Generic_ICollection_T');
    this.ireadOnlyListT = bridge.coreType('System_Collections_Generic_IReadOnlyList_T');
    this.ireadOnlyCollectionT = bridge.coreType('System_Collections_Generic_IReadOnlyCollection_T');
    this.augment();
    declareNumericConstants(this);
    declareExceptionTypes(this);
    declareVarargsTypes(bridge);
    Object.assign(this, declareSpanTypes(this), declareIndexRangeTypes(this), declareCoreTypeRelations(this));
    this.task = bridge.coreType('System_Threading_Tasks_Task');
    this.taskT = bridge.coreType('System_Threading_Tasks_Task_T');
    this.valueTask = bridge.coreType('System_Threading_Tasks_ValueTask');
    this.valueTaskT = bridge.coreType('System_Threading_Tasks_ValueTask_T');
    declareAsyncEnumeration(this);
    declareAwaiterTypes(this);
    declareFormattableTypes(this);
    declareExpressionTreeTypes(this);
    this.type = bridge.coreType('System_Type');
    this.attribute = bridge.coreType('System_Attribute');
    declareAttributeTypes(this);
    declareArrayMembers(this);
    Object.assign(this, declareComparisonInterfaces(this));
  }
  /**
   * Members every C# program may use but the closed registry does not list: the System.Object surface (so user types
   * can call and override Equals/GetHashCode/ToString), Enum.HasFlag and the Nullable<T> members. Added once per bridge.
   */
  augment() {
    const bridge = this.bridge;
    if (bridge.coreAugmented) return;
    bridge.coreAugmented = true;
    const method = (owner, name, returnType, parameters = [], modifiers = 0) => {
      if (
        owner
          .getMembers(name)
          .some(
            m =>
              m.kind === 'Method' &&
              m.parameters.length === parameters.length &&
              !!(m.modifiers & DeclarationModifiers.Static) === !!(modifiers & DeclarationModifiers.Static),
          )
      )
        return;
      owner.addMember(
        new MethodSymbol({
          name,
          returnType,
          parameters: parameters.map(([n, t]) => new ParameterSymbol({ name: n, type: t })),
          declaredAccessibility: Accessibility.Public,
          modifiers,
          isImplicitlyDeclared: true,
        }),
      );
    };
    const V = DeclarationModifiers.Virtual,
      S = DeclarationModifiers.Static,
      o = this.object;
    // Registry builtins may already declare these slots before augmentation; retain their exact virtual contract.
    for (const [name, result, parameters] of [['ToString', this.string, []], ['Equals', this.bool, [o]], ['GetHashCode', this.int, []]]) {
      for (const m of o.getMembers(name)) {
        if (m.kind === 'Method' && !m.isStatic && !m.arity && m.returnType === result &&
            m.parameters.length === parameters.length && m.parameters.every((parameter, index) => parameter.type === parameters[index])) {
          m.modifiers |= V;
        }
      }
    }
    method(o, 'ToString', this.string, [], V);
    method(o, 'Equals', this.bool, [['obj', o]], V);
    method(o, 'GetHashCode', this.int, [], V);
    method(o, 'GetType', bridge.coreType('System_Type'));
    if (!o.getMembers('.ctor').length) {
      const constructor = { name: '.ctor', methodKind: MethodKind.Constructor, returnType: this.void, parameters: [] };
      o.addMember(new MethodSymbol({ ...constructor, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true }));
    }
    method(
      o,
      'Equals',
      this.bool,
      [
        ['objA', o],
        ['objB', o],
      ],
      S,
    );
    method(
      o,
      'ReferenceEquals',
      this.bool,
      [
        ['objA', o],
        ['objB', o],
      ],
      S,
    );
    method(this.enumType, 'HasFlag', this.bool, [['flag', this.enumType]]);
    method(this.enumType, 'CompareTo', this.int, [['target', o]]);
    this.augmentDelegates(method);
    this.augmentEnumeration(method);
    const n = this.nullable,
      t = n.typeParameters[0];
    if (!n.getMembers('HasValue').length) {
      const getter = (name, type) => {
        const get = new MethodSymbol({
          name: 'get_' + name,
          methodKind: MethodKind.PropertyGet,
          returnType: type,
          declaredAccessibility: Accessibility.Public,
          modifiers: DeclarationModifiers.ReadOnly,
          isImplicitlyDeclared: true,
        });
        n.addMember(get);
        n.addMember(
          new PropertySymbol({ name, type, getMethod: get, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true }),
        );
      };
      n.addMember(new MethodSymbol({
        name: '.ctor',
        methodKind: MethodKind.Constructor,
        returnType: this.void,
        parameters: [new ParameterSymbol({name: 'value', type: t})],
        declaredAccessibility: Accessibility.Public,
        isImplicitlyDeclared: true,
      }));
      getter('HasValue', this.bool);
      getter('Value', t);
      n.addMember(
        new MethodSymbol({
          name: 'GetValueOrDefault',
          returnType: t,
          parameters: [],
          declaredAccessibility: Accessibility.Public,
          modifiers: DeclarationModifiers.ReadOnly,
          isImplicitlyDeclared: true,
        }),
      );
      n.addMember(
        new MethodSymbol({
          name: 'GetValueOrDefault',
          returnType: t,
          parameters: [new ParameterSymbol({ name: 'defaultValue', type: t })],
          declaredAccessibility: Accessibility.Public,
          modifiers: DeclarationModifiers.ReadOnly,
          isImplicitlyDeclared: true,
        }),
      );
    }
  }
  /**
   * `System.Func<...>` and `System.Action<...>` of every arity the core table lists get their `Invoke` method, so
   * lambdas convert to them and their values can be invoked. (The registry lists only closed parameterless forms.)
   */
  augmentDelegates(method) {
    for (let arity = 1; arity <= 5; arity++) {
      const func = this.func(arity),
        parameters = func.typeParameters.slice(0, -1).map((p, i) => ['arg' + (arity > 2 ? i + 1 : ''), p]);
      method(func, 'Invoke', func.typeParameters.at(-1), parameters);
    }
    for (let arity = 0; arity <= 4; arity++) {
      const action = this.action(arity);
      method(
        action,
        'Invoke',
        this.void,
        action.typeParameters.map((p, i) => [arity > 1 ? 'arg' + (i + 1) : 'obj', p]),
      );
    }
  }
  /**
   * The members of `IEnumerable<T>`, `IEnumerator<T>` and their non-generic forms that iterators and hand-written
   * enumeration loops use.
   */
  augmentEnumeration(method) {
    const abstract = DeclarationModifiers.Abstract,
      generic = this.ienumeratorT.construct(new TypeWithAnnotations(this.ienumerableT.typeParameters[0]));
    const forms = [
      { enumerable: this.ienumerableT, enumerator: this.ienumeratorT, element: this.ienumeratorT.typeParameters[0], returned: generic },
      { enumerable: this.ienumerable, enumerator: this.ienumerator, element: this.object, returned: this.ienumerator },
    ];
    for (const { enumerable, enumerator, element, returned } of forms) {
      method(enumerable, 'GetEnumerator', returned, [], abstract);
      method(enumerator, 'MoveNext', this.bool, [], abstract);
      if (enumerator === this.ienumeratorT) method(enumerator, 'Dispose', this.void, [], abstract);
      if (enumerator.getMembers('Current').length) continue;
      const get = new MethodSymbol({
        name: 'get_Current',
        methodKind: MethodKind.PropertyGet,
        returnType: element,
        declaredAccessibility: Accessibility.Public,
        modifiers: abstract,
        isImplicitlyDeclared: true,
      });
      enumerator.addMember(get);
      enumerator.addMember(
        new PropertySymbol({ name: 'Current', type: element, getMethod: get, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true }),
      );
    }
  }
  /** The type a C# type keyword denotes (including nint/nuint), or null. */
  keyword(word) {
    return this.byKeyword.get(word) ?? null;
  }
  /** T? for a value type T. */
  nullableOf(type) {
    return this.nullable.construct(type instanceof TypeWithAnnotations ? type : new TypeWithAnnotations(type));
  }
  /** T[] (rank 1) or a multi-dimensional array; arrays implement IList<T> and friends through System.Array. */
  arrayOf(element, rank = 1) {
    const bare = element instanceof TypeWithAnnotations ? element.type : element;
    return new ArrayTypeSymbol(element, rank, {
      baseType: () => this.array,
      interfaces:
        rank === 1
          ? () =>
              [this.ilistT, this.icollectionT, this.ienumerableT, this.ireadOnlyListT, this.ireadOnlyCollectionT]
                .map(i => i.construct(bare))
                .concat(this.ienumerable)
          : () => [this.ienumerable],
    });
  }
  func(arity) {
    return this.bridge.coreType('System_Func_T' + arity);
  }
  action(arity) {
    return this.bridge.coreType('System_Action' + (arity ? '_T' + arity : ''));
  }
  /** The underlying type of an enum (int when unspecified); null for other types. */
  enumUnderlying(type) {
    return type?.typeKind === TypeKind.Enum ? (type.originalDefinition.enumUnderlyingType ?? this.int) : null;
  }
}
let shared = null;
/** Core types over the shared framework bridge. */
export function coreTypes() {
  return (shared ??= new CoreTypes());
}
