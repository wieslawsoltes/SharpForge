/**
 * The members a record has in metadata beyond the ones the symbol table declares (SF-A02-T30), as Roslyn writes them:
 *
 *   IEquatable<R>      the interface every record implements through its `Equals(R)` *
 *   EqualityContract   `protected virtual Type EqualityContract { get; }` of a record class (an override in a derived one)
 *   PrintMembers       `protected virtual bool PrintMembers(StringBuilder)`; private in a sealed record and in a struct
 *   <Clone>$           `public virtual R <Clone>$()` of a record class, which `with` calls
 *   Equals(Base)       the sealed override a derived record has for the `Equals` of its base record
 *
 * They are method and property symbols of their own (not members of the type symbol), planned like declared members,
 * so they have definition tokens and are named through the same MemberRef / TypeSpec rules. A member the program
 * declares itself is used instead of a synthesized one. `Equals(R)` of an unsealed record class is made virtual.
 */
import { MethodAttributes } from '@sharpforge/cil';
import { Accessibility, SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodSymbol, ParameterSymbol, PropertySymbol, MethodKind, DeclarationModifiers } from '../../symbols/members.js';
import { baseRecordOf, isInheritedPositional } from '../../symbols/synthesized/records.js';
import { plannedMethod } from './member-plan.js';

export { baseRecordOf, isInheritedPositional };

/** The kinds of record members synthesized here; the ones the symbol table declares are `RecordMember` (symbols/synthesized/records.js). */
export const RecordBody = Object.freeze({
  PrintMembers: 'PrintMembers',
  EqualityContract: 'get_EqualityContract',
  Clone: '<Clone>$',
  EqualsBase: 'Equals(base)',
});

const isMethod = member => member.kind === SymbolKind.Method;
/** True for `bool Equals(R other)` declared in the record `type`. */
function isTypedEquals(method, type) {
  if (!method || method.name !== 'Equals' || method.isStatic || method.parameters.length !== 1) return false;
  const parameterType = method.parameters[0].type;
  return (parameterType.originalDefinition ?? parameterType) === type;
}
const isInstance = member => !member.isStatic && !member.isConst;

/** A member of a constructed type that stands for `symbol` of its definition: what a call on that type names. */
export function memberOn(owner, symbol) {
  if ((owner.originalDefinition ?? owner) === owner) return symbol;
  return Object.create(symbol, { containingType: { value: owner }, originalDefinition: { value: symbol } });
}

/** The instance fields of a record in declaration order, backing fields of auto-properties included. */
export function storedFields(type) {
  const fields = [];
  for (const member of type.getMembers()) {
    if (!isInstance(member)) continue;
    if (member.kind === SymbolKind.Field) fields.push(member);
    else if (member.kind === SymbolKind.Property && member.backingField && !isInheritedPositional(type, member)) fields.push(member.backingField);
  }
  return [...new Set(fields)];
}

/** The members `PrintMembers` prints: public instance fields and readable, non-overriding public properties. */
export function printableMembers(type) {
  return type.getMembers().filter(member => {
    if (!isInstance(member) || member.declaredAccessibility !== Accessibility.Public) return false;
    if (member.kind === SymbolKind.Field) return !member.associatedSymbol;
    if (member.kind !== SymbolKind.Property || isInheritedPositional(type, member)) return false;
    return !member.parameters?.length && !!member.getMethod && !member.isOverride;
  });
}

export class RecordPlan {
  /** @param core the core types of the compilation */
  constructor(core) {
    this.core = core;
    this.byType = new Map();
  }
  /**
   * The record members of a type definition that this plan knows by role: `{printMembers, equalityContract, clone,
   * equalsBase, synthesized}`; `equalityContract` is the property, a role the record kind does not have is null, and
   * `synthesized` lists the symbols created here.
   */
  membersOf(type) {
    const definition = type.originalDefinition ?? type;
    let members = this.byType.get(definition);
    if (!members) this.byType.set(definition, (members = this.create(definition)));
    return members;
  }
  create(type) {
    const core = this.core,
      isClass = type.typeKind === TypeKind.Class,
      base = baseRecordOf(type),
      inherited = base ? this.membersOf(base) : null,
      synthesized = [],
      // A virtual member is an override in a derived record, virtual in an unsealed root and plain in a sealed root.
      slot = base ? DeclarationModifiers.Override : isClass && !type.isSealed ? DeclarationModifiers.Virtual : 0,
      hidden = isClass && (base || !type.isSealed) ? Accessibility.Protected : Accessibility.Private;
    const method = (kind, init) => {
      const symbol = new MethodSymbol({ methodKind: MethodKind.Ordinary, containingSymbol: type, isImplicitlyDeclared: true, ...init });
      symbol.recordMember = kind;
      symbol.hasBody = !symbol.isAbstract;
      synthesized.push(symbol);
      return symbol;
    };
    const declared = (name, count) => type.getMembers(name).find(member => isMethod(member) && member.parameters.length === count) ?? null;
    const builder = core.bridge.coreType('System_Text_StringBuilder');
    const printMembers =
      declared('PrintMembers', 1) ??
      method(RecordBody.PrintMembers, {
        name: 'PrintMembers',
        returnType: core.bool,
        parameters: [new ParameterSymbol({ name: 'builder', type: builder })],
        declaredAccessibility: hidden,
        modifiers: slot,
      });
    if (!isClass) return { printMembers, equalityContract: null, clone: null, equalsBase: null, synthesized };
    const declaredContract = type.getMembers('EqualityContract').find(member => member.kind === SymbolKind.Property),
      equalityContract = declaredContract ?? this.contract(type, method, slot, hidden);
    // A derived record's clone returns the derived type: a covariant override of the base's clone (C# 9), which
    // metadata states with a new slot and a MethodImpl row.
    const self = type.typeParameters?.length ? type.construct(type.typeParameters) : type,
      abstract = type.isAbstract ? DeclarationModifiers.Abstract : 0,
      cloneSlot = base || !type.isSealed ? DeclarationModifiers.Virtual : 0;
    const clone = method(RecordBody.Clone, {
      name: '<Clone>$',
      returnType: self,
      parameters: [],
      declaredAccessibility: Accessibility.Public,
      modifiers: abstract | cloneSlot,
    });
    if (inherited?.clone) clone.covariantOverride = memberOn(base, inherited.clone);
    const equalsBase = base
      ? method(RecordBody.EqualsBase, {
          name: 'Equals',
          returnType: core.bool,
          parameters: [new ParameterSymbol({ name: 'other', type: base })],
          declaredAccessibility: Accessibility.Public,
          modifiers: DeclarationModifiers.Override | DeclarationModifiers.Sealed,
        })
      : null;
    return { printMembers, equalityContract, clone, equalsBase, synthesized };
  }
  /** `EqualityContract`: the property and its getter. */
  contract(type, method, slot, accessibility) {
    const getter = method(RecordBody.EqualityContract, {
      name: 'get_EqualityContract',
      methodKind: MethodKind.PropertyGet,
      returnType: this.core.type,
      parameters: [],
      declaredAccessibility: accessibility,
      modifiers: slot,
    });
    const property = new PropertySymbol({
      name: 'EqualityContract',
      type: this.core.type,
      getMethod: getter,
      containingSymbol: type,
      declaredAccessibility: accessibility,
      modifiers: slot,
      isImplicitlyDeclared: true,
    });
    getter.associatedSymbol = property;
    property.isSynthesizedRecordMember = true;
    return property;
  }
  /** Adds the synthesized record members of a source type to its member plan. */
  extend(type, plan) {
    if (!type.isRecord || (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct)) return;
    const members = this.membersOf(type),
      planned = new Map(members.synthesized.map(symbol => [symbol, plannedMethod(type, symbol)]));
    for (const [symbol, entry] of planned) {
      entry.isCompilerGenerated = true;
      if (symbol.covariantOverride) entry.overrides = symbol.covariantOverride;
    }
    plan.methods.push(...planned.values());
    const contract = members.equalityContract;
    if (contract?.isSynthesizedRecordMember) plan.properties.push({ symbol: contract, getter: planned.get(contract.getMethod), setter: null });
    const self = type.typeParameters?.length ? type.construct(type.typeParameters) : type,
      isSealed = type.typeKind === TypeKind.Struct || type.isSealed,
      typedEquals = plan.methods.find(entry => isTypedEquals(entry.symbol, type));
    plan.interfaces = [this.core.iequatableT.construct([self])];
    // `Equals(R)` fills the slot of `IEquatable<R>.Equals`; a record that can be derived from leaves it overridable.
    if (typedEquals && !(typedEquals.flags & MethodAttributes.Virtual)) {
      typedEquals.flags |= MethodAttributes.Virtual | MethodAttributes.NewSlot | (isSealed ? MethodAttributes.Final : 0);
    }
  }
}
