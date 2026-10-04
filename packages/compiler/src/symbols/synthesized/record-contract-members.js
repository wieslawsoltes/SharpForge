/**
 * `PrintMembers` and `EqualityContract` of a record (SF-A02-T30): the two synthesized members a program can name -
 * `base.PrintMembers(builder)` in an override of a derived record, `EqualityContract` in a hand-written `Equals`.
 *
 *   PrintMembers       `protected virtual bool PrintMembers(StringBuilder)`; private in a sealed record and in a struct
 *   EqualityContract   `protected virtual Type EqualityContract { get; }` of a record class
 *
 * In a derived record both are overrides. They are not in the member list of the type (the back ends that do not
 * emit them never see them): member lookup adds them, and code generation plans the same symbols, so a call that
 * was bound to one names the method that is emitted. One pair per record definition, kept on the definition.
 */
import { Accessibility, SymbolKind, TypeKind } from '../types.js';
import { MethodSymbol, ParameterSymbol, PropertySymbol, MethodKind, DeclarationModifiers } from '../members.js';
import { baseRecordOf } from './records.js';
import { recordContractType } from './record-nullability.js';

/** The kinds code generation builds the bodies from (codegen/metadata/record-plan.js names them `RecordBody`). */
export const RecordContractBody = Object.freeze({ PrintMembers: 'PrintMembers', EqualityContract: 'get_EqualityContract' });

export const PRINT_MEMBERS = 'PrintMembers';
export const EQUALITY_CONTRACT = 'EqualityContract';

const isRecordDefinition = type => !!type.isRecord && (type.typeKind === TypeKind.Class || type.typeKind === TypeKind.Struct);

function declaredPrintMembers(type) {
  return type.getMembers(PRINT_MEMBERS).find(member => member.kind === SymbolKind.Method && member.parameters.length === 1) ?? null;
}

function declaredContract(type) {
  return type.getMembers(EQUALITY_CONTRACT).find(member => member.kind === SymbolKind.Property) ?? null;
}

function synthesize(type, core) {
  const isClass = type.typeKind === TypeKind.Class,
    base = baseRecordOf(type),
    // A virtual member is an override in a derived record, virtual in an unsealed root and plain in a sealed root.
    slot = base ? DeclarationModifiers.Override : isClass && !type.isSealed ? DeclarationModifiers.Virtual : 0,
    accessibility = isClass && (base || !type.isSealed) ? Accessibility.Protected : Accessibility.Private;
  const method = (kind, init) => {
    const symbol = new MethodSymbol({ methodKind: MethodKind.Ordinary, containingSymbol: type, isImplicitlyDeclared: true, ...init });
    symbol.recordMember = kind;
    symbol.hasBody = true;
    return symbol;
  };
  const printMembers = declaredPrintMembers(type)
    ? null
    : method(RecordContractBody.PrintMembers, {
        name: PRINT_MEMBERS,
        returnType: core.bool,
        parameters: [new ParameterSymbol({ name: 'builder', type: recordContractType(type, core.bridge.coreType('System_Text_StringBuilder')) })],
        declaredAccessibility: accessibility,
        modifiers: slot,
      });
  if (!isClass || declaredContract(type)) return { printMembers, equalityContract: null };
  const getter = method(RecordContractBody.EqualityContract, {
    name: 'get_EqualityContract',
    methodKind: MethodKind.PropertyGet,
    returnType: recordContractType(type, core.type),
    parameters: [],
    declaredAccessibility: accessibility,
    modifiers: slot,
  });
  const equalityContract = new PropertySymbol({
    name: EQUALITY_CONTRACT,
    type: recordContractType(type, core.type),
    getMethod: getter,
    containingSymbol: type,
    declaredAccessibility: accessibility,
    modifiers: slot,
    isImplicitlyDeclared: true,
  });
  getter.associatedSymbol = equalityContract;
  equalityContract.isSynthesizedRecordMember = true;
  return { printMembers, equalityContract };
}

/**
 * The synthesized contract members of a record definition.
 * @param type a record class or record struct definition  @param core the core types of the compilation
 * @returns {{printMembers: object|null, equalityContract: object|null}} null for a member the record declares itself
 *   (and for `EqualityContract` of a record struct, which has none)
 */
export function recordContractMembers(type, core) {
  const definition = type.originalDefinition ?? type;
  definition.synthesizedContractMembers ??= synthesize(definition, core);
  return definition.synthesizedContractMembers;
}

/** A member of a constructed type that stands for `symbol` of its definition. */
function memberOn(owner, symbol) {
  if ((owner.originalDefinition ?? owner) === owner) return symbol;
  return Object.create(symbol, { containingType: { value: owner }, originalDefinition: { value: symbol } });
}

/**
 * The synthesized contract member named `name` that `type` has beside its declared members, as a member of `type`
 * (which may be a construction of a generic record); null when the name is another one, `type` is no source record or
 * declares the member itself.
 */
export function recordContractMember(type, name, core) {
  if (name !== PRINT_MEMBERS && name !== EQUALITY_CONTRACT) return null;
  const definition = type.originalDefinition ?? type;
  if (!isRecordDefinition(definition) || !definition.isSource) return null;
  const members = recordContractMembers(definition, core),
    member = name === PRINT_MEMBERS ? members.printMembers : members.equalityContract;
  return member ? memberOn(type, member) : null;
}
