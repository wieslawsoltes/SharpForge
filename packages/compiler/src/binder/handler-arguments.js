/**
 * `[InterpolatedStringHandlerArgument]` (C# 10): a handler parameter that names the receiver ("") or other
 * parameters of the call it belongs to; their arguments are passed to the handler's constructor after the two
 * counts:
 *
 *   builder.Append(provider, $"{x}")
 *     ->  new AppendInterpolatedStringHandler(literalLength, formattedCount, builder, provider)
 *
 * The call is bound first; when one of its arguments is converted to a handler type, `handlerArgumentsOf` gives the
 * constructor arguments that stand for the named arguments (`InterpolatedStringHandlerArgumentPlaceholder` nodes
 * with the index of the argument, -1 for the receiver). The emitter evaluates the receiver and the arguments before
 * the handler once and reads them again where the placeholders are.
 *
 * Not bound (the conversion is left unbound, nothing is reported): a named parameter whose argument is omitted or
 * comes after the handler, and the receiver of a static method or a constructor.
 */
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';

export const handlerArgumentAttribute = 'System.Runtime.CompilerServices.InterpolatedStringHandlerArgumentAttribute';

/** The string constants of one attribute argument: a string, or the elements of a `string[]`. */
function stringsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(element => stringsOf(element?.value ?? element));
  return [];
}

/** The names of a bound (source) attribute: constants, or the elements of an array creation. */
function sourceNames(attribute) {
  return (attribute.arguments ?? []).flatMap(argument => {
    if (argument.constantValue) return stringsOf(argument.constantValue.value);
    const elements = argument.initializer?.elements ?? argument.elements ?? [];
    return elements.flatMap(element => stringsOf(element.constantValue?.value));
  });
}

/**
 * The argument names a handler parameter asks for.
 * @returns {string[]|null} null when the parameter has no `[InterpolatedStringHandlerArgument]`
 */
export function handlerArgumentNames(parameter) {
  const definition = parameter.originalDefinition ?? parameter,
    [bound] = attributesNamed(definition, handlerArgumentAttribute);
  if (bound) return sourceNames(bound);
  const imported = (definition.boundAttributes ? null : definition.attributes)?.find(
    attribute => attribute.attributeClassName === handlerArgumentAttribute,
  );
  return imported ? imported.constructorArguments.flatMap(argument => stringsOf(argument.value)) : null;
}

/**
 * What the handler constructor receives for the argument at `index` of a call being finished.
 * @param {{method, mapping, receiver, args}} call the resolved method, its argument mapping, receiver and arguments
 * @returns {null|false|Array<{argumentIndex:number, type:object, refKind:string|null}>} null when the parameter asks
 *   for nothing, false when what it asks for is not bound
 */
export function handlerArgumentsOf(call, index) {
  const method = call.method,
    definition = method.originalDefinition ?? method,
    position = call.mapping.parameterOf[index],
    names = handlerArgumentNames(definition.parameters[position] ?? method.parameters[position]);
  if (!names) return null;
  const found = [];
  for (const name of names) {
    if (name === '') {
      const type = call.receiver?.type ?? method.containingType;
      if (method.isStatic || !type || method.methodKind === MethodKind.Constructor) return false;
      found.push({ argumentIndex: -1, type, refKind: null });
      continue;
    }
    const parameterIndex = method.parameters.findIndex(parameter => parameter.name === name),
      argumentIndex = call.mapping.parameterOf.indexOf(parameterIndex);
    if (parameterIndex < 0 || argumentIndex < 0 || argumentIndex >= index) return false;
    found.push({ argumentIndex, type: call.parameterTypes[argumentIndex], refKind: null });
  }
  return found;
}
