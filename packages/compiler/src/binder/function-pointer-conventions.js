/** Decode the calling convention of a method addressed by a function pointer. */
import { attributesNamed, fullNameOf } from './bound-attributes.js';
import { knownFunctionPointerConventions, normalizeCallingConventions } from '../symbols/function-pointer-conventions.js';

export { knownFunctionPointerConventions } from '../symbols/function-pointer-conventions.js';

export const unmanagedCallersOnlyName = 'System.Runtime.InteropServices.UnmanagedCallersOnlyAttribute';

/** The well-known attribute, or null for a managed entry point. */
export function unmanagedCallersOnlyAttribute(method) {
  return attributesNamed(method.originalDefinition ?? method, unmanagedCallersOnlyName)[0] ?? null;
}

function unconverted(expression) {
  let value = expression;
  while (value?.kind === 'Conversion') value = value.operand;
  return value;
}

/** Marker types from the bound `CallConvs` array, with their original attribute-argument nodes. */
export function unmanagedConventionMarkers(attribute) {
  const argument = attribute.named.find(entry => entry.name === 'CallConvs');
  const value = unconverted(argument?.value);
  if (!value || value.literal === 'null' || value.constantValue?.isNull) return [];
  return (value.elements ?? []).map(element => {
    const expression = unconverted(element);
    return { type: expression?.operandType ?? null, syntax: expression?.syntax ?? attribute.syntax };
  });
}

/** The recognized convention marker's suffix, or null for an invalid `CallConvs` type. */
export function functionPointerConventionName(type) {
  const definition = type?.originalDefinition ?? type;
  if (definition?.isSource) return null;
  const assembly = definition?.containingAssembly?.identity?.name;
  if (assembly && !['System.Runtime', 'System.Private.CoreLib', 'mscorlib'].includes(assembly)) return null;
  const prefix = 'System.Runtime.CompilerServices.CallConv';
  const name = fullNameOf(type);
  if (!name.startsWith(prefix)) return null;
  const suffix = name.slice(prefix.length);
  return knownFunctionPointerConventions.includes(suffix) ? suffix : null;
}

/** A method's managed or unmanaged convention in the function-pointer signature shape. */
export function methodCallingConvention(method) {
  const attribute = unmanagedCallersOnlyAttribute(method);
  if (!attribute) return { callingConvention: 'managed', unmanagedConventions: [] };
  return {
    callingConvention: 'unmanaged',
    unmanagedConventions: normalizeCallingConventions(
      unmanagedConventionMarkers(attribute).map(marker => functionPointerConventionName(marker.type)).filter(Boolean),
    ),
  };
}
