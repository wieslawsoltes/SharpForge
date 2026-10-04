/**
 * Span conversions (C# 14 first-class spans, and the array a `params ReadOnlySpan<T>` parameter is built from): the
 * language conversion is emitted as the call of the operator the span types declare, as Roslyn lowers it.
 *
 *   T[] -> Span<T>                        Span<T>.op_Implicit(T[])
 *   T[] -> ReadOnlySpan<U>                ReadOnlySpan<U>.op_Implicit(U[])        (array covariance needs no code)
 *   string -> ReadOnlySpan<char>          string.op_Implicit(string)
 *   Span<T> -> ReadOnlySpan<T>            Span<T>.op_Implicit(Span<T>)
 *   ... -> ReadOnlySpan<U>, T below U     then ReadOnlySpan<U>.CastUp<T>(ReadOnlySpan<T>)
 *   explicit T[] -> Span<U> / ReadOnlySpan<U>   `castclass U[]`, then as above
 *
 * The operators come from the referenced core library; the framework registry does not declare them, so without
 * reference assemblies the conversion stays unsupported.
 */
import { ArrayTypeSymbol, SymbolKind } from '../../symbols/types.js';
import { spanElementType } from '../../conversions/span.js';
import { emitUtf8Literal } from './emit-utf8-strings.js';

const spanKinds = new Set(['ImplicitSpan', 'ExplicitSpan']);

/** The static method `name` of `owner` that takes one argument of `parameterType` and returns `returnType`. */
function conversionOperator(owner, parameterType, returnType, name = 'op_Implicit') {
  return owner.getMembers(name).find(member => {
    const isOperator = member.kind === SymbolKind.Method && member.isStatic && member.parameters.length === 1;
    return isOperator && member.parameters[0].type.equals(parameterType) && (!returnType || member.returnType.equals(returnType));
  });
}

/** Class mixin: span conversions. */
export const SpanConversionEmission = Base =>
  class extends Base {
    exprConversion(node) {
      if (!spanKinds.has(node.conversion?.kind)) return super.exprConversion(node);
      this.expression(node.operand);
      return this.spanConversion(node.operand.type, node.type, { syntax: node.syntax, isExplicit: node.conversion.kind === 'ExplicitSpan' });
    }
    /** `"text"u8` wraps preplanned UTF-8 data; the terminal NUL is stored beyond the visible span length. */
    exprUtf8Literal(node) {
      return emitUtf8Literal(this, node);
    }
    /** Converts the array, string or span on the stack to the span type `to`. */
    spanConversion(from, to, { syntax = null, isExplicit = false } = {}) {
      const fail = () => this.unsupported(`converting '${from.toDisplayString()}' to '${to.toDisplayString()}'`, syntax),
        call = method => (method ? this.callMethod(method, { syntax }) : fail());
      if (from instanceof ArrayTypeSymbol) {
        const element = to.typeArguments[0].type,
          arrayType = from.elementType.equals(element) ? from : new ArrayTypeSymbol(element);
        // An explicit span conversion converts the array first: a `castclass` that fails as the array cast would.
        if (isExplicit) this.il.emit('castclass', this.tokens.type(arrayType));
        return call(conversionOperator(to, arrayType, to));
      }
      if (from.specialType === 'System_String') return call(conversionOperator(from, from, to));
      const target = spanElementType(to, 'ReadOnlySpan'),
        spanSource = spanElementType(from, 'Span'),
        source = spanSource ?? spanElementType(from, 'ReadOnlySpan');
      if (!target || !source) return fail();
      const readOnlySource = to.originalDefinition.construct(source);
      if (spanSource) call(conversionOperator(from, from, readOnlySource));
      if (source.equals(target)) return undefined;
      const castUp = to.getMembers('CastUp').find(member => member.kind === SymbolKind.Method && member.isStatic && member.arity === 1);
      return call(castUp?.construct(source));
    }
  };
