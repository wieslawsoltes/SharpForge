/**
 * The awaitable pattern (C# 5, SF-A02-T58). `await e` needs, on the type of `e`:
 *
 *   GetAwaiter()     an accessible instance (or extension) method without parameters, returning the awaiter type A
 *   A.IsCompleted    a readable instance property of type bool
 *   A.GetResult()    an accessible instance method without parameters; its return type is the type of the await
 *   A : INotifyCompletion (ICriticalNotifyCompletion derives from it), which supplies OnCompleted
 *
 * Every diagnostic is reported on the whole await expression, as Roslyn does:
 *
 *   CS4001  the operand has no type (`await null`, a method group, a lambda)
 *   CS1061  no member named GetAwaiter          CS1955  GetAwaiter is not a method
 *   CS1986  GetAwaiter is static or returns void   CS7036  GetAwaiter or GetResult has a required parameter
 *   CS0122  GetAwaiter or GetResult is inaccessible
 *   CS0117  the awaiter has no IsCompleted property or no GetResult method
 *   CS0176  IsCompleted or GetResult is static     CS4011  IsCompleted is not a readable bool property
 *   CS4027  the awaiter does not implement INotifyCompletion
 *
 * `Task`, `Task<T>`, `ValueTask` and `ValueTask<T>` are awaited without looking the pattern up (the registry does not
 * list their awaiters); an operand of type `dynamic` is bound at run time (binder/dynamic.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { implementsInterface } from '../symbols/substitution.js';
import { lookupMembers } from './inheritance.js';
import { extensionEnumeratorMethod } from './foreach-extension.js';

const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};
const isMethod = member => member.kind === SymbolKind.Method;
const takesNoArguments = method => method.parameters.every(p => p.isOptional || p.hasExplicitDefaultValue || p.isParams);
const requiredParameter = method => method.parameters.find(p => !(p.isOptional || p.hasExplicitDefaultValue || p.isParams));
const failure = (code, args = []) => ({ error: { code, args } });

/** The parameterless method `name` of `type`, or the diagnostic that says why there is none usable. */
function patternMethod(binder, type, name, missing) {
  const found = lookupMembers(type, name, binder.core, { within: binder.c.containingType });
  if (!found.members.length) {
    if (found.inaccessible.length) return failure(DiagnosticId.CS0122, [found.inaccessible[0].toDisplayString()]);
    return missing();
  }
  const first = found.members[0];
  if (!isMethod(first)) return failure(DiagnosticId.CS1955, [first.toDisplayString()]);
  const method = found.members.find(member => isMethod(member) && takesNoArguments(member));
  if (method) return { method };
  return failure(DiagnosticId.CS7036, [requiredParameter(first).name, first.toDisplayString()]);
}

/**
 * Resolves the awaitable pattern for a bound operand.
 * @returns `{ getAwaiter, isCompleted, getResult, resultType, isExtension }`, `{ error: { code, args } }`, or
 *   `{ isUnknown: true }` when the operand or its awaiter is a framework type whose members the registry may not list.
 */
export function resolveAwaitable(binder, operand) {
  const type = operand.type,
    display = t => binder.display(t);
  const awaiterMethod = patternMethod(binder, type, 'GetAwaiter', () => {
    const extension = extensionEnumeratorMethod(binder, operand, 'GetAwaiter');
    if (extension) return { method: extension, isExtension: true };
    // A registry type may have an awaiter the registry does not list; a predefined type has none.
    if (!isSource(type) && !type.specialType && type.typeKind !== TypeKind.TypeParameter) return { isUnknown: true };
    return failure(DiagnosticId.CS1061, [display(type), 'GetAwaiter']);
  });
  if (!awaiterMethod.method) return awaiterMethod;
  const getAwaiter = awaiterMethod.method,
    awaiter = getAwaiter.returnType;
  const unsuitable = () => failure(DiagnosticId.CS1986, [display(type)]);
  if ((getAwaiter.isStatic && !awaiterMethod.isExtension) || !awaiter || awaiter.specialType === 'System_Void') return unsuitable();
  if (awaiter.isErrorType?.()) return { isUnknown: true };
  if (awaiter.typeKind === TypeKind.Dynamic) return { getAwaiter, resultType: awaiter, isExtension: !!awaiterMethod.isExtension, isDynamic: true };

  const within = binder.c.containingType,
    completed = lookupMembers(awaiter, 'IsCompleted', binder.core, { within }),
    isCompleted = completed.members[0];
  const isKnown = isSource(awaiter) || !!awaiter.specialType || awaiter.originalDefinition === binder.core.taskAwaiterT || awaiter === binder.core.taskAwaiter;
  if (!isCompleted || isCompleted.kind !== SymbolKind.Property) {
    if (!isCompleted && completed.inaccessible.length) return failure(DiagnosticId.CS0122, [completed.inaccessible[0].toDisplayString()]);
    return isKnown ? failure(DiagnosticId.CS0117, [display(awaiter), 'IsCompleted']) : { isUnknown: true };
  }
  if (isCompleted.isStatic) return failure(DiagnosticId.CS0176, [isCompleted.toDisplayString()]);
  const patternFailure = () => failure(DiagnosticId.CS4011, [display(awaiter), getAwaiter.toDisplayString()]);
  if (!isCompleted.getMethod || isCompleted.type?.specialType !== 'System_Boolean') return patternFailure();

  const result = patternMethod(binder, awaiter, 'GetResult', () => failure(DiagnosticId.CS0117, [display(awaiter), 'GetResult']));
  if (!result.method) return result.error?.code === DiagnosticId.CS1955 ? patternFailure() : result;
  if (result.method.isStatic) return failure(DiagnosticId.CS0176, [result.method.toDisplayString()]);

  const core = binder.core,
    notify = core.inotifyCompletion;
  if (notify && !implementsInterface(awaiter, notify, core)) return failure(DiagnosticId.CS4027, [display(awaiter), notify.toDisplayString()]);
  return {
    getAwaiter,
    isCompleted,
    getResult: result.method,
    resultType: result.method.returnType,
    isExtension: !!awaiterMethod.isExtension,
  };
}

/** What `await` cannot be applied to when the operand has no type, as CS4001 names it; null for an operand with a type. */
export function untypedAwaitOperand(operand) {
  if (operand.type) return null;
  if (operand.kind === 'MethodGroup') return 'method group';
  if (operand.form === 'lambda') return operand.syntax?.kind === 'AnonymousMethodExpression' ? 'anonymous method' : 'lambda expression';
  if (operand.literal === 'null') return '<null>';
  return null;
}
