const widths = [['int', 'Int32'], ['uint', 'UInt32'], ['long', 'Int64'], ['ulong', 'UInt64']];
const parameterNames = Object.freeze(['val1', 'val2']);

function extrema(type, suffix) {
  return ['Min', 'Max'].map(name => {
    const params = Object.freeze([type, type]);
    const signature = Object.freeze({kind: 'method', parameters: params, returnType: type,
      isStatic: true, genericArity: 0, callingConvention: 0});
    const math = Object.freeze({kind: 'method', owner: 'System.Math', name, signature});
    return Object.freeze({name: `Math.${name}#2:${suffix}`, min: 2, max: 2, result: type, params, math, parameterNames});
  });
}

/** Exact integral source overloads; their existing wire order remains unchanged. */
export const sourceMathBuiltins = Object.freeze(widths.flatMap(([type, suffix]) => extrema(type, suffix)));

/** Appended separately after all intervening released numeric families. */
export const sourceSingleMathBuiltins = Object.freeze(extrema('float', 'Single'));
