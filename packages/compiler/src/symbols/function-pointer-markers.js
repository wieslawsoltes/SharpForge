/** Calling-convention marker classes used when binding without reference assemblies. */
import { Accessibility, NamedTypeSymbol } from './types.js';
import { MethodKind, MethodSymbol } from './members.js';
import { knownFunctionPointerConventions } from './function-pointer-conventions.js';

/** Declares framework marker classes on the compilation's registry bridge; existing declarations take precedence. */
export function declareFunctionPointerMarkers(globalNamespace, core) {
  const container = globalNamespace.ensureNamespace('System.Runtime.CompilerServices');
  for (const convention of knownFunctionPointerConventions) {
    const name = 'CallConv' + convention;
    if (container.getTypeMembers(name, 0).length) continue;
    const type = container.addType(new NamedTypeSymbol({ name, baseType: core.object, declaredAccessibility: Accessibility.Public }));
    type.addMember(new MethodSymbol({
      name: '.ctor',
      methodKind: MethodKind.Constructor,
      returnType: core.void,
      declaredAccessibility: Accessibility.Public,
      isImplicitlyDeclared: true,
    }));
  }
}
