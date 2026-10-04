import {attachExceptionBuiltins} from './exception-builtins.js';
/**
 * The exception classes of the base class library for compilations bound against the closed framework registry
 * (SF-A02-T44).
 *
 * The registry lists `System.Exception` with one constructor and `Message`. The language rules about exceptions need
 * more than that: catch clauses are ordered by the inheritance of the caught types (CS0160), a class deriving from
 * Exception calls a base constructor, and `throw new ArgumentNullException(...)` is ordinary C# 1 code. The hierarchy
 * and the constructors below are those of System.Runtime; a member that is not listed is a framework gap, as on every
 * registry type.
 *
 * Binding a member declared here says nothing about whether the runtime profile can execute it: code generation
 * reports what it cannot lower.
 */
import { NamedTypeSymbol, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

/** Constructor shapes, as lists of [parameter name, type key]; `e` is System.Exception, `s` string, `o` object. */
const standard = [[], [['message', 's']], [['message', 's'], ['innerException', 'e']]];
const argument = [
  ...standard,
  [['message', 's'], ['paramName', 's']],
  [['message', 's'], ['paramName', 's'], ['innerException', 'e']],
];
const namedArgument = [[], [['paramName', 's']], [['paramName', 's'], ['message', 's']], [['message', 's'], ['innerException', 'e']]];
const argumentOutOfRange = [...namedArgument, [['paramName', 's'], ['actualValue', 'o'], ['message', 's']]];
const objectDisposed = [[['objectName', 's']], [['objectName', 's'], ['message', 's']], [['message', 's'], ['innerException', 'e']]];

/** [namespace, name, base class name, constructors, read-only string properties]. Bases precede the classes derived from them. */
const hierarchy = [
  ['System', 'SystemException', 'Exception', standard],
  ['System', 'ApplicationException', 'Exception', standard],
  ['System', 'AggregateException', 'Exception', standard],
  ['System', 'ArgumentException', 'SystemException', argument, ['ParamName']],
  ['System', 'ArgumentNullException', 'ArgumentException', namedArgument],
  ['System', 'ArgumentOutOfRangeException', 'ArgumentException', argumentOutOfRange],
  ['System', 'ArithmeticException', 'SystemException', standard],
  ['System', 'DivideByZeroException', 'ArithmeticException', standard],
  ['System', 'OverflowException', 'ArithmeticException', standard],
  ['System', 'ArrayTypeMismatchException', 'SystemException', standard],
  ['System', 'FormatException', 'SystemException', standard],
  ['System', 'IndexOutOfRangeException', 'SystemException', standard],
  ['System', 'InvalidCastException', 'SystemException', standard],
  ['System', 'InvalidOperationException', 'SystemException', standard],
  ['System', 'ObjectDisposedException', 'InvalidOperationException', objectDisposed, ['ObjectName']],
  ['System', 'NotImplementedException', 'SystemException', standard],
  ['System', 'NotSupportedException', 'SystemException', standard],
  ['System', 'NullReferenceException', 'SystemException', standard],
  ['System', 'OperationCanceledException', 'SystemException', standard],
  ['System', 'OutOfMemoryException', 'SystemException', standard],
  ['System', 'RankException', 'SystemException', standard],
  ['System', 'StackOverflowException', 'SystemException', standard],
  ['System', 'TimeoutException', 'SystemException', standard],
  ['System', 'UnauthorizedAccessException', 'SystemException', standard],
  ['System.Collections.Generic', 'KeyNotFoundException', 'SystemException', standard],
  ['System.IO', 'IOException', 'SystemException', standard],
  ['System.IO', 'FileNotFoundException', 'IOException', standard],
  ['System.Threading', 'SynchronizationLockException', 'SystemException', standard],
];

function hasConstructor(type, parameterTypes) {
  return type.getMembers('.ctor').some(
    candidate =>
      candidate.parameters.length === parameterTypes.length && candidate.parameters.every((parameter, i) => parameter.type.equals(parameterTypes[i])),
  );
}

function addConstructors(type, shapes, typeOf, voidType) {
  for (const shape of shapes) {
    const parameters = shape.map(([name, key], ordinal) => new ParameterSymbol({ name, type: typeOf[key], ordinal }));
    if (hasConstructor(type, parameters.map(parameter => parameter.type))) continue;
    type.addMember(new MethodSymbol({ ...publicMember, name: '.ctor', methodKind: MethodKind.Constructor, returnType: voidType, parameters }));
  }
}

function addGetter(type, name, propertyType, modifiers = 0) {
  if (type.getMembers(name).length) return;
  const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: propertyType, modifiers });
  type.addMember(getMethod);
  type.addMember(new PropertySymbol({ ...publicMember, name, type: propertyType, getMethod, modifiers }));
}

/** The members of System.Exception the registry does not list. */
function completeException(core) {
  const exception = core.exception,
    typeOf = { s: core.string, e: exception, o: core.object };
  addConstructors(exception, standard, typeOf, core.void);
  addGetter(exception, 'InnerException', exception);
  addGetter(exception, 'StackTrace', core.string, DeclarationModifiers.Virtual);
  addGetter(exception, 'Source', core.string, DeclarationModifiers.Virtual);
  addGetter(exception, 'HResult', core.int);
  if (!exception.getMembers('GetBaseException').length)
    exception.addMember(
      new MethodSymbol({ ...publicMember, name: 'GetBaseException', returnType: exception, parameters: [], modifiers: DeclarationModifiers.Virtual }),
    );
  attachExceptionBuiltins(exception);
  return typeOf;
}

/**
 * Declares the hierarchy once per bridge. A class that is already declared (the special-type table lists two of them)
 * keeps its identity and gets the base class and constructors of the table above.
 */
export function declareExceptionTypes(core) {
  // A referenced core library (it has an `assembly`) declares its own exception classes with all their members.
  if (core.bridge.assembly || core.exception.isErrorType()) return;
  const bridge = core.bridge.bridge ?? core.bridge;
  if (bridge.exceptionTypesDeclared) return;
  bridge.exceptionTypesDeclared = true;
  const typeOf = completeException(core),
    byName = new Map([['Exception', core.exception]]);
  for (const [namespaceName, name, baseName, constructors, properties = []] of hierarchy) {
    const container = bridge.globalNamespace.ensureNamespace(namespaceName),
      baseType = byName.get(baseName);
    let type = container.getTypeMembers(name, 0)[0];
    if (type) type._base = baseType;
    else type = container.addType(new NamedTypeSymbol({ name, baseType }));
    byName.set(name, type);
    addConstructors(type, constructors, typeOf, core.void);
    for (const property of properties) addGetter(type, property, core.string, DeclarationModifiers.Virtual);
    attachExceptionBuiltins(type);
  }
}
