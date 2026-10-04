const definitions = [];

function add(owner, name, parameters, returnType, isStatic = false) {
  definitions.push(Object.freeze({
    owner,
    name,
    parameters: Object.freeze(parameters),
    returnType,
    isStatic,
    implementation: 'varargs'
  }));
}
add('System.ArgIterator', '.ctor', ['System.RuntimeArgumentHandle'], 'void');
add('System.ArgIterator', 'GetRemainingCount', [], 'int');
add('System.ArgIterator', 'GetNextArg', [], 'typedref');
add('System.ArgIterator', 'GetNextArg', ['System.RuntimeTypeHandle'], 'typedref');
add('System.ArgIterator', 'GetNextArgType', [], 'System.RuntimeTypeHandle');
add('System.ArgIterator', 'End', [], 'void');
add('System.TypedReference', 'ToObject', ['typedref'], 'object', true);
add('System.TypedReference', 'GetTargetType', ['typedref'], 'System.Type', true);
add('System.TypedReference', 'TargetTypeToken', ['typedref'], 'System.RuntimeTypeHandle', true);
export const varargsIntrinsicDefinitions = Object.freeze(definitions);

/** Pure MethodTable contribution for runtime-provided CLI argument structures. */
export function varargsTypeDefinition(name) {
  const size = {
    'System.ArgIterator': 24,
    'System.RuntimeArgumentHandle': 8,
    'System.TypedReference': 16
  } [name];
  return size ? {
    base: 'System.ValueType',
    flags: {
      valueType: true,
      sealed: true
    },
    valueSize: size,
    fields: []
  } : null;
}

export function fixedCallSignature(signature) {
  return signature.callingConvention === 5 && signature.sentinel !== undefined ? {
    ...signature,
    parameters: signature.parameters.slice(0, signature.sentinel)
  } : signature;
}

/** The call site's sentinel separates the exact MethodDef signature from optional slots. */
export function validVarargsSignature(declaration, callSite, signatureKey) {
  return declaration.callingConvention === 5 && callSite.callingConvention === 5 &&
    (callSite.sentinel ?? callSite.parameters.length) === declaration.parameters.length &&
    signatureKey(declaration) === signatureKey(fixedCallSignature(callSite));
}
