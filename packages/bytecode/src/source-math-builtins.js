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

const signWidths = [['sbyte', 'SByte'], ['short', 'Int16'], ['int', 'Int32'],
  ['long', 'Int64'], ['float', 'Single'], ['double', 'Double']];
const signParameterNames = Object.freeze(['value']);

/** Exact unary overloads append after Single extrema; every result is Int32. */
export const sourceSignMathBuiltins = Object.freeze(signWidths.map(([type, suffix]) => {
  const params = Object.freeze([type]);
  const signature = Object.freeze({kind: 'method', parameters: params, returnType: 'int',
    isStatic: true, genericArity: 0, callingConvention: 0});
  const math = Object.freeze({kind: 'method', owner: 'System.Math', name: 'Sign', signature});
  return Object.freeze({name: `Math.Sign#1:${suffix}`, min: 1, max: 1, result: 'int',
    params, math, parameterNames: signParameterNames});
}));

const smallWidths = [['sbyte', 'SByte'], ['byte', 'Byte'], ['short', 'Int16'], ['ushort', 'UInt16']];

/** Keep narrow result types while appending after every released Sign entry. */
export const sourceSmallMathBuiltins = Object.freeze(smallWidths.flatMap(([type, suffix]) => extrema(type, suffix)));
