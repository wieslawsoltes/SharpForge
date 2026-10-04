/** Public constructors of the compiler's registry-only span declarations; imported definitions are never augmented. */
import { Accessibility, PointerTypeSymbol } from './types.js';
import { MethodKind, MethodSymbol, ParameterSymbol } from './members.js';

/** Add the three array/pointer overloads the real Span<T> and ReadOnlySpan<T> contracts declare. */
export function declareSpanConstructors(owner, core, element) {
  const array = core.arrayOf(element);
  const signatures = [
    [['array', array]],
    [['array', array], ['start', core.int], ['length', core.int]],
    [['pointer', new PointerTypeSymbol(core.void)], ['length', core.int]],
  ];
  for (const signature of signatures) {
    owner.addMember(new MethodSymbol({
      name: '.ctor',
      methodKind: MethodKind.Constructor,
      declaredAccessibility: Accessibility.Public,
      isImplicitlyDeclared: true,
      returnType: core.void,
      parameters: signature.map(([name, type]) => new ParameterSymbol({ name, type })),
    }));
  }
}
