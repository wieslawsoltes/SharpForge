/** Framework methods used by expression-tree rewriting before CIL emission (SF-A02-T07.5). */
import { NamedTypeSymbol, TypeKind, Accessibility } from './types.js';
import { NamespaceSymbol } from './namespaces.js';
import { MethodSymbol, ParameterSymbol, DeclarationModifiers } from './members.js';

const byCore = new WeakMap();

function reflectionMethodInfo(core) {
  const library = core.bridge,
    name = 'System.Reflection.MethodInfo',
    imported = library.assembly?.getTypeByMetadataName(name) ?? library.referencedType?.(name);
  if (imported && !imported.isErrorType?.()) return imported;
  const namespace = new NamespaceSymbol('Reflection', new NamespaceSymbol('System', new NamespaceSymbol('', null)));
  return new NamedTypeSymbol({
    name: 'MethodInfo', typeKind: TypeKind.Class, containingSymbol: namespace,
    declaredAccessibility: Accessibility.Public, baseType: () => core.object,
  });
}

/** Finds the exact metadata signature, retaining a symbol-only fallback for the registry compilation axis. */
function frameworkMethod(owner, name, result, parameters, isStatic = false) {
  const existing = owner.getMembers(name).find(member => member.kind === 'Method' && !member.arity && member.isStatic === isStatic &&
    member.parameters.length === parameters.length && member.parameters.every((parameter, index) => parameter.type.equals(parameters[index])));
  return existing ?? new MethodSymbol({
    name, containingSymbol: owner, returnType: result,
    parameters: parameters.map((type, ordinal) => new ParameterSymbol({ name: 'arg' + ordinal, type, ordinal })),
    declaredAccessibility: Accessibility.Public, modifiers: isStatic ? DeclarationModifiers.Static : 0, isImplicitlyDeclared: true,
  });
}

/** Reflection creation and delegate operator methods, resolved once per compilation. */
export function expressionTreeMethods(core) {
  let result = byCore.get(core);
  if (!result) {
    const methodInfo = reflectionMethodInfo(core),
      binary = (name, type) => frameworkMethod(core.delegate, name, type, [core.delegate, core.delegate], true);
    result = Object.freeze({
      methodInfo,
      createDelegate: frameworkMethod(methodInfo, 'CreateDelegate', core.delegate, [core.type, core.object]),
      combine: binary('Combine', core.delegate), remove: binary('Remove', core.delegate),
      equal: binary('op_Equality', core.bool), notEqual: binary('op_Inequality', core.bool),
    });
    byCore.set(core, result);
  }
  return result;
}
