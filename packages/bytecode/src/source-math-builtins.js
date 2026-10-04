const widths = [['int', 'Int32'], ['uint', 'UInt32'], ['long', 'Int64'], ['ulong', 'UInt64']];
const parameterNames = Object.freeze(['val1', 'val2']);

/** Exact integral source overloads; released numeric Min/Max entries remain separate. */
export const sourceMathBuiltins = Object.freeze(widths.flatMap(([type, suffix]) => ['Min', 'Max'].map(name => {
  const params = Object.freeze([type, type]);
  const signature = Object.freeze({kind: 'method', parameters: params, returnType: type,
    isStatic: true, genericArity: 0, callingConvention: 0});
  const math = Object.freeze({kind: 'method', owner: 'System.Math', name, signature});
  return Object.freeze({name: `Math.${name}#2:${suffix}`, min: 2, max: 2, result: type, params, math, parameterNames});
})));
