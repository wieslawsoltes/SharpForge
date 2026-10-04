/**
 * Synthesized delegate types (C# 10 natural function types, SF-A02-T75; C# 12 lambda defaults and `params`,
 * SF-A02-T80). A lambda or method group has a natural type; when its signature does not fit `Action` or `Func` - a
 * by-reference parameter, an optional parameter, a `params` parameter, more parameters than the registered `Func`
 * and `Action` types take - the compiler declares a delegate type for it. Two functions with the same signature
 * (types, reference kinds, default values, `params`) share one type, so their values are assignable to each other.
 *
 * The type cannot be named in source. It is a delegate like a declared one: an `Invoke` method carries the signature,
 * which is all that conversions, calls and code generation look at.
 */
import { TypeKind, RefKind, Accessibility, NamedTypeSymbol } from '../types.js';
import { MethodKind, MethodSymbol, ParameterSymbol } from '../members.js';

const sameConstant = (left, right) => (left?.isNull || left?.value === null ? right?.isNull || right?.value === null : left?.value === right?.value);

function sameParameter(known, wanted) {
  return (
    known.type.equals(wanted.type) &&
    known.refKind === (wanted.refKind ?? RefKind.None) &&
    !!known.isParams === !!wanted.isParams &&
    !!known.isOptional === !!wanted.isOptional &&
    (!known.isOptional || sameConstant(known.defaultValue, wanted.defaultValue))
  );
}

/**
 * The synthesized delegate type of a signature.
 * @param driver the semantic analysis (owns the per-compilation cache)  @param core the core types
 * @param {{type:object, refKind?:string, isParams?:boolean, isOptional?:boolean, defaultValue?:object}[]} parameters
 *   `defaultValue` is the constant of an optional parameter (absent for `default` and `null` of a type without constants)
 * @param returnType the return type (`void` for none)
 * @returns the delegate type symbol (`isSynthesizedDelegate`)
 */
export function synthesizedDelegateOf(driver, core, parameters, returnType) {
  const known = (driver.synthesizedDelegates ??= []);
  const existing = known.find(
    entry =>
      entry.returnType.equals(returnType) &&
      entry.parameters.length === parameters.length &&
      entry.parameters.every((parameter, index) => sameParameter(parameter, parameters[index])),
  );
  if (existing) return existing.symbol;
  const symbol = new NamedTypeSymbol({
    // Not the metadata name `<>f__AnonymousDelegateN`: the image reads angle brackets in a type name as type arguments.
    name: `AnonymousDelegate(${known.length})`,
    typeKind: TypeKind.Delegate,
    declaredAccessibility: Accessibility.Public,
    baseType: () => core.multicastDelegate,
    isSealed: true,
    isImplicitlyDeclared: true,
  });
  symbol.isSynthesizedDelegate = true;
  /** The position among the synthesized delegates of the compilation: the `N` of its metadata name. */
  symbol.synthesizedOrdinal = known.length;
  symbol.toDisplayString = () => '<anonymous delegate>';
  const invoke = new MethodSymbol({
    name: 'Invoke',
    methodKind: MethodKind.DelegateInvoke,
    returnType,
    parameters: parameters.map(
      (parameter, ordinal) =>
        new ParameterSymbol({
          name: parameters.length === 1 ? 'arg' : 'arg' + (ordinal + 1),
          type: parameter.type,
          ordinal,
          refKind: parameter.refKind ?? RefKind.None,
          isParams: !!parameter.isParams,
          isOptional: !!parameter.isOptional,
          ...(parameter.isOptional && parameter.defaultValue !== undefined ? { explicitDefaultValue: { value: parameter.defaultValue } } : {}),
        }),
    ),
    containingSymbol: symbol,
    declaredAccessibility: Accessibility.Public,
    isImplicitlyDeclared: true,
  });
  symbol.addMember(invoke);
  known.push({
    symbol,
    returnType,
    parameters: parameters.map(parameter => ({ ...parameter, refKind: parameter.refKind ?? RefKind.None })),
  });
  return symbol;
}
