/**
 * `stackalloc T[n]`, `stackalloc T[] { ... }` and `stackalloc[] { ... }` (C# 7.2 span form, C# 7.3 initializers).
 *
 * In an expression context the result is a `Span<T>` whose memory lives in the current method, which is what ref
 * safety tracks (flow/ref-safety.js, CS8353). Directly initializing a `var` or pointer local makes it a `T*`
 * instead: that needs an unsafe context (CS0214), and inside one pointers are bound by the unsafe-code epic, so the
 * form stays a lenient node there.
 *
 * Shape rules (SF-A02-T66): the element type is unmanaged (CS0208), there is a size or an initializer (CS1586), a
 * constant size is not negative (CS0247) and equals the number of initializer elements (CS0847). The expression
 * converts to `Span<T>` and `ReadOnlySpan<T>` of its own element type only (CS8346).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { ArrayTypeSymbol } from '../../symbols/types.js';
import { isUnmanagedType } from '../constraints.js';

/** True when the syntax is inside an `unsafe` block or a declaration marked `unsafe`. */
function inUnsafeContext(syntax) {
  for (let node = syntax.parent; node; node = node.parent) {
    if (node.kind === 'UnsafeStatement') return true;
    if ([...(node.modifiers ?? [])].some(token => token.text === 'unsafe')) return true;
  }
  return false;
}

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
        // The pointer form needs an unsafe context; inside one, pointers are bound by the unsafe-code epic.
        if (initializesPointerLocal(syntax) && !inUnsafeContext(syntax)) {
          this.report(syntax, DiagnosticId.CS0214);
          return this.bad(syntax);
        }
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
          this.report(syntax, DiagnosticId.CS0826);
          return this.bad(syntax);
        }
      } else {
        const arrayType = this.bindType(syntax.type).type;
        if (!(arrayType instanceof ArrayTypeSymbol) || arrayType.isErrorType()) {
          this.bindStackAllocOperands(syntax);
          return this.bad(syntax);
        }
        elementType = arrayType.elementType;
        const rank = syntax.type.rankSpecifiers[0],
          sizeSyntax = rank?.sizes.find(candidate => candidate.kind !== 'OmittedArraySizeExpression');
        if (sizeSyntax) size = this.convert(this.value(sizeSyntax), this.core.int, sizeSyntax);
        if (initializer) values = initializer.expressions.map(expression => this.value(expression));
        if (!this.checkStackAllocShape(syntax, { elementType, rank, sizeSyntax, size, values })) return this.bad(syntax);
      }
      const elements = values ? values.map(value => this.convert(value, elementType, value.syntax)) : null;
      return this.node('StackAlloc', syntax, this.core.span.construct(elementType), {
        elementType,
        sizes: size ? [size] : [],
        elements,
      });
    }
    /**
     * The rules of `stackalloc T[n] { ... }`: T is unmanaged (CS0208), there is a size or an initializer (CS1586), a
     * constant size is not negative (CS0247) and agrees with the initializer (CS0847). @returns false after reporting
     */
    checkStackAllocShape(syntax, { elementType, rank, sizeSyntax, size, values }) {
      if (!elementType.isErrorType() && !isUnmanagedType(elementType)) {
        this.report(syntax.type.elementType ?? syntax.type, DiagnosticId.CS0208, [this.display(elementType)]);
        return false;
      }
      if (!sizeSyntax && !values) {
        this.report(rank ?? syntax, DiagnosticId.CS1586);
        return false;
      }
      const constant = size && !size.hasErrors && size.constantValue ? Number(size.constantValue.value) : null;
      if (constant !== null && constant < 0) {
        this.report(sizeSyntax, DiagnosticId.CS0247);
        return false;
      }
      if (constant !== null && values && values.length !== constant) {
        this.report(syntax, DiagnosticId.CS0847, [constant]);
        return false;
      }
      return true;
    }
    /** A stackalloc converts to a span of its element type only; any other target is CS8346, not a conversion between types. */
    reportConversionFailure(e, type, node, c) {
      if (e.kind !== 'StackAlloc') return super.reportConversionFailure(e, type, node, c);
      this.report(node, DiagnosticId.CS8346, [this.display(e.elementType), this.display(type)]);
    }
    /** Binds the size and initializer expressions of a stackalloc that is not typed here, for their own diagnostics. */
    bindStackAllocOperands(syntax) {
      for (const size of syntax.type?.rankSpecifiers?.[0]?.sizes ?? []) {
        if (size.kind !== 'OmittedArraySizeExpression') this.value(size);
      }
      for (const expression of syntax.initializer?.expressions ?? []) this.value(expression);
    }
  };
