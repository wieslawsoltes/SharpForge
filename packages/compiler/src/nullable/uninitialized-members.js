/**
 * CS8618 where no constructor body can report it (C# 8 nullable reference types).
 *
 * The nullable walker reports a non-nullable reference field or auto-property that a constructor leaves without a
 * value when that constructor exits. Two cases have no constructor body to walk:
 *   - a class without an instance constructor: its instance members are reported on themselves;
 *   - static members of a type without a static constructor: reported on themselves.
 * A member with an initializer, a `required` member and a nullable or oblivious member are fine.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { NullableAnnotation, SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const needsValue = member =>
  member.typeWithAnnotations?.nullableAnnotation === NullableAnnotation.NotAnnotated &&
  member.type?.isReferenceType === true &&
  !member.initializerSyntax &&
  !member.isRequired &&
  !member.isConst;

/**
 * @param type a source class or struct declared where nullable warnings are enabled
 * @returns {{ code: 'CS8618', args: string[], member: object }[]}
 */
export function uninitializedMembersWithoutConstructor(type) {
  const results = [];
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return results;
  const members = type.getMembers(),
    declares = kind => members.some(m => m.kind === SymbolKind.Method && m.methodKind === kind && !m.isImplicitlyDeclared);
  const hasInstanceConstructor = declares(MethodKind.Constructor),
    hasStaticConstructor = declares(MethodKind.StaticConstructor);
  for (const member of members) {
    const isField = member.kind === SymbolKind.Field && !member.isImplicitlyDeclared,
      isAutoProperty = member.kind === SymbolKind.Property && member.isAutoProperty;
    if ((!isField && !isAutoProperty) || !needsValue(member)) continue;
    // A struct without a constructor is created by `default`, which the language lets leave its fields null.
    if (member.isStatic ? hasStaticConstructor : hasInstanceConstructor || type.typeKind === TypeKind.Struct) continue;
    results.push({ code: DiagnosticId.CS8618, args: [isField ? 'field' : 'property', member.name], member });
  }
  return results;
}
