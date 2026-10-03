/**
 * Struct declarations and value semantics (SF-A02-T04.1, C# spec 16).
 *
 * Declaration rules: instance fields may not form a layout cycle (CS0523); before C# 10 a struct has no explicit
 * parameterless constructor (CS8773-family gate "parameterless struct constructors") and no instance field
 * initializers ("struct field initializers"); from C# 10 a struct with field initializers and no declared constructor
 * is CS8983; a parameterless constructor must be public (CS8958).
 * Value semantics: `copyOnAssignment` (every assignment, argument pass and return of a struct copies it), `isBoxing`
 * (struct to object/interface allocates a box holding a copy), `this` is a variable of the struct type inside
 * instance members (assignable unless the member or struct is readonly), and `default(S)` zero-initialises without
 * running a constructor.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind, Accessibility } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isNullableType } from '../conversions/nullable.js';

const instanceFields = type =>
  type
    .getMembers()
    .filter(m => m.kind === SymbolKind.Field && !m.isStatic)
    .concat(
      type
        .getMembers()
        .filter(m => m.kind === SymbolKind.Property && !m.isStatic && m.backingField)
        .map(p => p.backingField),
    );
/** The instance fields of a struct, auto-property backing fields included (the unit of layout and definite assignment). */
export const structInstanceFields = instanceFields;
/**
 * Layout cycles: a struct that (transitively) contains an instance field of its own type.
 * @returns [{code:'CS0523',args:[field display,field type display],field}]
 */
export function checkStructLayout(type) {
  const results = [];
  if (type.typeKind !== TypeKind.Struct) return results;
  const reaches = (t, seen) => {
    t = isNullableType(t) ? t.nullableUnderlyingType : t;
    if (!t || t.typeKind !== TypeKind.Struct || t.specialType) return false;
    const def = t.originalDefinition;
    if (def === type.originalDefinition) return true;
    if (seen.has(def)) return false;
    seen.add(def);
    return instanceFields(def).some(f => f.type && reaches(f.type, seen));
  };
  for (const field of instanceFields(type)) {
    if (!field.type) continue;
    if (reaches(field.type, new Set()))
      results.push({
        code: DiagnosticId.CS0523,
        args: [(field.associatedSymbol ?? field).toDisplayString(), field.type.toDisplayString()],
        field: field.associatedSymbol ?? field,
      });
  }
  return results;
}
/**
 * Constructor and initializer rules of a struct at a language version.
 * @returns [{code,args,member,feature?:{name,version}}] - `feature` entries are version gates the caller turns into the Roslyn feature diagnostic
 */
export function checkStructDeclaration(type, languageVersion) {
  const results = [];
  if (type.typeKind !== TypeKind.Struct) return results;
  const ctors = type.getMembers('.ctor').filter(c => c.methodKind === MethodKind.Constructor && !c.isImplicitlyDeclared),
    parameterless = ctors.find(c => c.parameters.length === 0 && !c.isPrimaryConstructor);
  const initialized = type
    .getMembers()
    .filter(m => !m.isStatic && (m.kind === SymbolKind.Field || m.kind === SymbolKind.Property) && m.initializerSyntax);
  if (parameterless) {
    if (languageVersion < 10) results.push({ member: parameterless, feature: { name: 'parameterless struct constructors', version: 10 } });
    else if (parameterless.declaredAccessibility !== Accessibility.Public)
      results.push({ code: DiagnosticId.CS8958, args: [], member: parameterless });
  }
  if (initialized.length) {
    if (languageVersion < 10)
      for (const m of initialized) results.push({ member: m, feature: { name: 'struct field initializers', version: 10 } });
    else if (!ctors.length && !type.primaryConstructor) results.push({ code: DiagnosticId.CS8983, args: [], member: type });
  }
  return results;
}
/** True when storing a value of this type copies it (structs, enums, nullable value types, value-constrained type parameters). */
export const copyOnAssignment = type => type.isValueType === true;
/** True when converting `from` to `to` allocates a box (a copy of the struct on the heap). */
export const isBoxing = conversion => conversion?.kind === 'Boxing';
/** `this` in an instance member of a struct is a variable (ref this); it is read-only in readonly members and readonly structs. */
export function thisIsAssignable(method, type) {
  return type.typeKind === TypeKind.Struct && !type.isReadOnly && !method.isReadOnly && !method.isStatic;
}
/** The implicit parameterless constructor of a struct zero-initialises: `new S()` equals `default(S)` when none is declared. */
export function usesDefaultInitialization(type) {
  return type.typeKind === TypeKind.Struct && !type.getMembers('.ctor').some(c => c.parameters.length === 0 && !c.isImplicitlyDeclared);
}
