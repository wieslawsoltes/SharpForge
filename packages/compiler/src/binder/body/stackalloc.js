/**
 * `stackalloc T[n]`, `stackalloc T[] { ... }` and `stackalloc[] { ... }` (C# 7.2 span form, C# 7.3 initializers).
 *
 * In an expression context the result is a `Span<T>` whose memory lives in the current method, which is what ref
 * safety tracks (flow/ref-safety.js, CS8353). Directly initializing a `var` or pointer local makes it a `T*`
 * instead: pointers are bound by the unsafe-code epic, so that form stays a lenient node.
 */
import { ArrayTypeSymbol } from '../../symbols/types.js';

/** True when the stackalloc is the whole initializer of a local declared `var` or with a pointer type. */
function initializesPointerLocal(syntax) {
  const declarator = syntax.parent?.kind === 'EqualsValueClause' ? syntax.parent.parent : null;
  const declaration = declarator?.kind === 'VariableDeclarator' ? declarator.parent : null;
  const typeSyntax = declaration?.kind === 'VariableDeclaration' ? declaration.type : null;
  if (!typeSyntax) return false;
  return typeSyntax.kind === 'PointerType' || (typeSyntax.kind === 'IdentifierName' && typeSyntax.identifier.valueText === 'var');
}

/** Class mixin: stack allocation expressions. */
export const StackAllocBinding = Base =>
  class extends Base {
    stackAlloc(syntax) {
      const initializer = syntax.initializer ?? null;
      if (initializesPointerLocal(syntax) || this.core.span.isErrorType()) {
        this.bindStackAllocOperands(syntax);
        return this.lenient(syntax);
      }
      let elementType = null;
      let size = null;
      let values = null;
      if (syntax.kind === 'ImplicitStackAllocArrayCreationExpression') {
        values = initializer.expressions.map(expression => this.value(expression));
        if (values.some(value => value.hasErrors)) return this.bad(syntax);
        elementType = this.bestCommonType(values);
        if (!elementType) {
          this.report(syntax, 'CS0826');
          return this.bad(syntax);
        }
      } else {
        const arrayType = this.bindType(syntax.type).type;
        if (!(arrayType instanceof ArrayTypeSymbol) || arrayType.isErrorType()) {
          this.bindStackAllocOperands(syntax);
          return this.bad(syntax);
        }
        elementType = arrayType.elementType;
        const sizeSyntax = syntax.type.rankSpecifiers[0]?.sizes.find(candidate => candidate.kind !== 'OmittedArraySizeExpression');
        if (sizeSyntax) size = this.convert(this.value(sizeSyntax), this.core.int, sizeSyntax);
        if (initializer) values = initializer.expressions.map(expression => this.value(expression));
      }
      const elements = values ? values.map(value => this.convert(value, elementType, value.syntax)) : null;
      return this.node('StackAlloc', syntax, this.core.span.construct(elementType), {
        elementType,
        sizes: size ? [size] : [],
        elements,
      });
    }
    /** Binds the size and initializer expressions of a stackalloc that is not typed here, for their own diagnostics. */
    bindStackAllocOperands(syntax) {
      for (const size of syntax.type?.rankSpecifiers?.[0]?.sizes ?? []) {
        if (size.kind !== 'OmittedArraySizeExpression') this.value(size);
      }
      for (const expression of syntax.initializer?.expressions ?? []) this.value(expression);
    }
  };
