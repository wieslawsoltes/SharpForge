/**
 * Extension methods, C# 3 form (SF-A02-E05): what a declaration with a `this` parameter must satisfy, and the
 * conversion of an extension method group (`receiver.Extension`) to a delegate.
 *
 *   CS1100  `this` on a parameter that is not the first      CS1104  `this` together with `params`
 *   CS1105  the method is not static                         CS1106  the class is not a non-generic static class
 *   CS1109  the class is nested                              CS1103  the first parameter is a pointer or `dynamic`
 *   CS8328  `this` together with `out`                       CS8337 / CS8338  `ref this` / `in this` on a type that
 *   CS1113  a delegate over an extension method whose                           is not a value type
 *           receiver is a value type
 *
 * Lookup and invocation are in overload/extension-methods.js; CS1929 and CS1061 are reported there.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isValidReceiverConversion } from '../overload/extension-methods.js';
import { convertMethodGroup, delegateArguments } from '../conversions/method-group.js';
import { delegateInvoke } from '../overload/type-inference.js';

const modifierOf = (parameter, word) => [...(parameter.syntax?.modifiers ?? [])].find(token => token.text === word) ?? null;

/** The rows for the `this` parameter of one extension method declaration. */
function receiverRows(method, parameter) {
  const rows = [],
    row = (code, at, args = []) => rows.push({ member: method, code, args, at }),
    type = parameter.type,
    thisToken = modifierOf(parameter, 'this'),
    paramsToken = modifierOf(parameter, 'params');
  if (paramsToken) row(DiagnosticId.CS1104, paramsToken);
  if (parameter.refKind === RefKind.Out) row(DiagnosticId.CS8328, thisToken, ['this', 'out']);
  const isValueReceiver = type?.isValueType === true || type?.typeKind === TypeKind.TypeParameter;
  if (parameter.refKind === RefKind.Ref && !isValueReceiver) row(DiagnosticId.CS8337, null, [method.name]);
  if (parameter.refKind === RefKind.In && !isValueReceiver) row(DiagnosticId.CS8338, null, [method.name]);
  if (type?.typeKind === TypeKind.Pointer || type?.typeKind === TypeKind.Dynamic) {
    row(DiagnosticId.CS1103, parameter.syntax.type, [type.toDisplayString()]);
  }
  return rows;
}

/**
 * The declaration rule for the extension methods of one source type.
 * @returns {object[]} rows `{ member, code, args, at? }` (see binder/members/declaration-checks.js); a row without
 *   `at` is reported at the member's name
 */
export function checkExtensionDeclarations(type) {
  const rows = [];
  let reportedContainer = false;
  for (const method of type.getMembers()) {
    if (method.kind !== SymbolKind.Method || method.methodKind !== MethodKind.Ordinary || method.isImplicitlyDeclared) continue;
    const first = method.parameters[0];
    for (const parameter of method.parameters.slice(1)) {
      const token = modifierOf(parameter, 'this');
      if (token) rows.push({ member: method, code: DiagnosticId.CS1100, args: [], at: token });
    }
    if (!first || !modifierOf(first, 'this')) continue;
    if (!type.isStatic || type.arity > 0) {
      // One diagnostic per class, at its name, however many extension methods it declares.
      if (!reportedContainer) rows.push({ member: type, code: DiagnosticId.CS1106, args: [] });
      reportedContainer = true;
    } else if (type.containingType) rows.push({ member: method, code: DiagnosticId.CS1109, args: [type.name] });
    else if (!method.isStatic) rows.push({ member: method, code: DiagnosticId.CS1105, args: [] });
    rows.push(...receiverRows(method, first));
  }
  return rows;
}

/** An extension method as the delegate target sees it: without its `this` parameter. */
function reducedForm(method) {
  const reduced = Object.create(method);
  Object.defineProperty(reduced, 'parameters', { value: method.parameters.slice(1) });
  reduced.reducedFrom = method;
  return reduced;
}

/** Class mixin for the body binder: `receiver.Extension` converted to a delegate. */
export const ExtensionMethodBinding = Base =>
  class extends Base {
    groupConversion(group, to) {
      if (!group.isExtensionOnly || !group.receiver || !delegateInvoke(to)) return super.groupConversion(group, to);
      // As an argument the group carries the argument's name in `name` (none): the method name is on the name node.
      group.name ??= group.nameNode?.identifier?.valueText ?? null;
      // The nearest scope with a method the receiver fits decides, as for an invocation.
      for (const scope of group.extensionScopes) {
        const fitting = scope.methods.filter(
          method =>
            method.name === group.name &&
            isValidReceiverConversion(this.conversions, group.receiver, method.parameters[0].type, { forMethodGroup: true }),
        );
        if (!fitting.length) continue;
        const result = this.extensionDelegate(group, fitting, to);
        group.lastConversionError = result.error ?? null;
        if (!result.conversion.exists) return null;
        const method = result.method.reducedFrom ?? result.method;
        method.uses = (method.uses ?? 0) + 1;
        if (group.receiver.type?.isValueType === true) {
          group.lastConversionError = { code: DiagnosticId.CS1113, args: [method.toDisplayString(), this.display(group.receiver.type)] };
          return null;
        }
        group.selected = method;
        group.isExtensionDelegate = true;
        return result.conversion;
      }
      return super.groupConversion(group, to);
    }
    /**
     * Converts the extension methods of one scope to the delegate type `to`. With several candidates the receiver
     * takes part in overload resolution as the first argument, so `Tag(string)` beats `Tag(object)` for a string.
     */
    extensionDelegate(group, methods, to) {
      let candidates = methods;
      if (methods.length > 1) {
        const args = [{ ...group.receiver, name: null }, ...delegateArguments(delegateInvoke(to))],
          best = this.d.overloads.resolve(methods, args, { typeArguments: group.typeArguments ?? null, name: group.name });
        if (best.succeeded) candidates = [best.method];
      }
      return convertMethodGroup({ methods: candidates.map(reducedForm), typeArguments: group.typeArguments, name: group.name }, to, this.d.overloads);
    }
  };
