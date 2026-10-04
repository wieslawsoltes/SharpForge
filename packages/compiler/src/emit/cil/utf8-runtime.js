/** Required and optional ReadOnlySpan<byte> constructors for C# 11 UTF-8 literal lowering. */
import { Accessibility, ArrayTypeSymbol, PointerTypeSymbol, RefKind, SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { DiagnosticId } from '../../diagnostics/codes.js';
import { UnsupportedInCil } from './unsupported.js';

/** A missing required helper has Roslyn's diagnostic, including the location of the literal that needs it. */
class MissingUtf8Constructor extends UnsupportedInCil {
  constructor(context) {
    super('the required ReadOnlySpan<T>(T[], int, int) constructor', context.syntax, context.uri);
    this.diagnosticCode = DiagnosticId.CS0656;
    this.diagnosticArguments = ['System.ReadOnlySpan<T>', '.ctor'];
  }
}

function constructorWithParameters(type, parameters) {
  return type.getMembers('.ctor').find(method => method.kind === SymbolKind.Method
    && method.methodKind === MethodKind.Constructor && !method.isStatic && !method.arity
    && method.declaredAccessibility === Accessibility.Public && method.returnType?.specialType === 'System_Void'
    && method.parameters.length === parameters.length && method.parameters.every((parameter, index) =>
      (!parameter.refKind || parameter.refKind === RefKind.None) && parameter.type.equals(parameters[index])));
}

/**
 * The array/start/length constructor is required even when optimized away. The pointer constructor is optional:
 * Roslyn uses an array, including its terminating NUL, when the target does not provide that optimization helper.
 * Members are taken from the actual constructed span type, preserving the reference's owning assembly/signature.
 */
export function utf8SpanConstructors(core, context) {
  const span = core.readOnlySpan.construct(core.byte);
  const arrayType = new ArrayTypeSymbol(core.byte);
  const array = constructorWithParameters(span, [arrayType, core.int, core.int]);
  if (!array) throw new MissingUtf8Constructor(context);
  const pointer = constructorWithParameters(span, [new PointerTypeSymbol(core.void), core.int]) ?? null;
  return { span, arrayType, array, pointer };
}
