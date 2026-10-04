/** Exact numeric CLR calls shared by source binding, emission and replay. */
function numericBuiltin(owner, name, parameters, result, sourceName = name, parameterNames = []) {
  const params = Object.freeze(parameters);
  const signature = Object.freeze({kind: 'method', parameters: params, returnType: result,
    isStatic: true, genericArity: 0, callingConvention: 0});
  const numeric = Object.freeze({kind: 'method', owner, name, signature});
  const prefix = owner === 'System.IntPtr' ? 'nint' : owner === 'System.UIntPtr' ? 'nuint' : owner.slice(7);
  return Object.freeze({name: prefix + '.' + sourceName, min: params.length, max: params.length,
    result, params, numeric, parameterNames: Object.freeze(parameterNames)});
}

// Append after released builtin families. Never insert a member into an existing range.
export const sourceNumericBuiltins = Object.freeze([
  numericBuiltin('System.BitConverter', 'SingleToInt32Bits', ['float'], 'int', undefined, ['value']),
  numericBuiltin('System.BitConverter', 'DoubleToInt64Bits', ['double'], 'long', undefined, ['value']),
  numericBuiltin('System.BitConverter', 'Int32BitsToSingle', ['int'], 'float', undefined, ['value']),
  numericBuiltin('System.BitConverter', 'Int64BitsToDouble', ['long'], 'double', undefined, ['value']),
  numericBuiltin('System.Math', 'IEEERemainder', ['double', 'double'], 'double', undefined, ['x', 'y']),
  numericBuiltin('System.IntPtr', 'get_Size', [], 'int', 'Size'),
  numericBuiltin('System.UIntPtr', 'get_Size', [], 'int', 'Size')
]);

export function appendNumericBuiltins(entries, firstId) {
  let id = firstId;
  for (const builtin of sourceNumericBuiltins) entries[id] = Object.freeze({...builtin, id: id++});
  return id;
}
