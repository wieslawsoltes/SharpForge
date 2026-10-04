/**
 * Destructors and extern members (SF-A02-T48, C# spec 15.13 and 15.6.8).
 *
 *   destructors  CS0575 outside a class, CS0574 name differs from the class, CS0106 any modifier but extern and
 *                unsafe, CS0111 a second destructor. (CS0711 in a static class is in ./type-modifiers.js.)
 *   extern       CS0179 with a body, CS0180 with abstract, CS0626 (warning) a method, operator or accessor without
 *                any attribute, CS0824 (warning) a constructor without any attribute, CS0601 DllImport on a method
 *                that is not static and extern.
 *
 * The rules read the bound attributes of a member, so they run after attribute binding. A destructor is compiled and
 * never called (the runtime has no finalization); calling an extern method is not executable (no platform invoke):
 * code generation reports both, see codegen/semantic/declarations.js.
 *
 * `operator true`/`operator false` and the `&&`/`||` forms over user-defined `&`/`|` are declared and lowered by the
 * member-operator modules (binder/members/operator-declarations.js, lowering/members/operators.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { isComImport } from './com-interop.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const destructorModifiers = new Set(['extern', 'unsafe']);

function checkDestructor(type, member, isFirst, add) {
  const identifier = member.syntax.identifier;
  for (const modifier of member.syntax.modifiers ?? []) if (!destructorModifiers.has(modifier.text)) add(DiagnosticId.CS0106, [modifier.text], identifier);
  if (!isFirst) add(DiagnosticId.CS0111, ['~' + type.name, type.toDisplayString()], identifier);
  if (type.typeKind !== TypeKind.Class) add(DiagnosticId.CS0575, [], identifier);
  else if (identifier.valueText !== type.name) add(DiagnosticId.CS0574, [], identifier);
}

function checkExtern(member, add) {
  const display = member.toDisplayString(),
    at = member.locations[0],
    // An attribute says where the code is (DllImport); the members of a COM class are implemented by its wrapper.
    hasAttributes = !!member.boundAttributes?.length || !!member.associatedSymbol?.boundAttributes?.length || isComImport(member.containingType);
  if (member.hasBody) add(DiagnosticId.CS0179, [display], at);
  else if (member.isAbstract) add(DiagnosticId.CS0180, [display], at);
  // An extern partial method is an implementing part: Roslyn reports the partial-method rules for it, not CS0626.
  else if (!hasAttributes && !(member.modifierWords ?? []).includes('partial'))
    add(member.methodKind === MethodKind.Constructor || member.methodKind === MethodKind.StaticConstructor ? DiagnosticId.CS0824 : DiagnosticId.CS0626, [display], at);
}

/**
 * The destructor and extern rules of one source type.
 * @returns {{code: string, args: any[], uri: string, node: object}[]}
 */
export function checkSpecialMembers(type) {
  const results = [];
  let destructors = 0;
  const visit = member => {
    if (member.kind !== SymbolKind.Method || member.isImplicitlyDeclared || !member.syntax) return;
    const uri = member.uri ?? member.locations?.[0]?.uri,
      add = (code, args, node) => results.push({ code, args, uri, node });
    if (member.methodKind === MethodKind.Destructor) checkDestructor(type, member, destructors++ === 0, add);
    if (member.isExtern && member.locations?.[0]) checkExtern(member, add);
    if (member.dllImport && !(member.isStatic && member.isExtern)) add(DiagnosticId.CS0601, [], member.dllImport.syntax.name);
  };
  for (const member of type.getMembers()) {
    visit(member);
    for (const accessor of [member.getMethod, member.setMethod]) if (accessor) visit(accessor);
    // An extern event is reported once, on the event: its accessors have no declaration of their own.
    if (member.kind === SymbolKind.Event && member.isExtern && !member.boundAttributes?.length && member.locations?.[0])
      results.push({ code: DiagnosticId.CS0626, args: [member.toDisplayString()], uri: member.uri ?? member.locations[0].uri, node: member.locations[0] });
  }
  return results;
}

/** Class mixin of the semantic analysis: the destructor and extern rules of every source type. */
export const SpecialMemberChecks = Base =>
  class extends Base {
    checkSpecialMembers() {
      for (const type of this.assembly.types) {
        if (type.typeKind === TypeKind.Enum || type.typeKind === TypeKind.Delegate) continue;
        for (const found of checkSpecialMembers(type)) this.report(found.uri, found.node, found.code, found.args);
      }
    }
  };
