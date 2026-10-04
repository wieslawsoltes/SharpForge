/** Complete valid ECMA target/source combinations; native width is supplied by the CLR process. */
export const conversionMatrixTargets = Object.freeze([
  ['i1', 'sbyte'], ['u1', 'byte'], ['i2', 'short'], ['u2', 'ushort'],
  ['i4', 'int'], ['u4', 'uint'], ['i8', 'long'], ['u8', 'ulong'],
  ['i', 'nint'], ['u', 'nuint'], ['r4', 'float'], ['r8', 'double'], ['r.un', 'double'],
].map(([opcode, type]) => Object.freeze({opcode, type})));

const sourceValues = Object.freeze({
  i4: ['0', '1', '-1', '127', '128', '255', '256', '32767', '32768', '65535', '65536', '2147483647', '-2147483648'],
  i8: ['0', '1', '-1', '2147483648', '4294967295', '4294967296', '9223372036854775807', '-9223372036854775808'],
  r4: ['0', '-0', '1.5', '-1.5', '127.9', '255.9', '32767.9', '65535.9', '2147483648', '4294967296',
    '9223372036854775808', '18446744073709551616', 'NaN', 'Infinity', '-Infinity'],
  r8: ['0', '-0', '1.5', '-1.5', '127.9', '255.9', '32767.9', '65535.9', '2147483647.9', '2147483648',
    '-2147483648.9', '4294967295.9', '4294967296', '9223372036854774784', '9223372036854775808',
    '18446744073709549568', '18446744073709551616', 'NaN', 'Infinity', '-Infinity'],
});

export function conversionMatrixCases(nativeIntBits) {
  const values = {...sourceValues, native: nativeIntBits === 64 ? sourceValues.i8 : sourceValues.i4};
  const cases = [];
  for (const [source, inputs] of Object.entries(values)) {
    for (const target of conversionMatrixTargets) {
      const modes = target.type === 'float' || target.type === 'double' ? [''] : ['', 'ovf.', 'ovf.un.'];
      for (const mode of modes) for (const input of inputs) {
        const opcode = mode === 'ovf.un.' ? `conv.ovf.${target.opcode}.un` : `conv.${mode}${target.opcode}`;
        cases.push({id: `${source}:${opcode}:${input}`, source, input, opcode, target: target.type, nativeIntBits});
      }
    }
  }
  return cases;
}

function floatingLiteral(input, type) {
  const owner = type === 'float' ? 'float' : 'double';
  if (input === 'NaN') return owner + '.NaN';
  if (input === 'Infinity') return owner + '.PositiveInfinity';
  if (input === '-Infinity') return owner + '.NegativeInfinity';
  return input + (type === 'float' ? 'F' : 'D');
}

/** C# spelling explicitly reproduces CLI sign/zero-extension rather than assuming casts are identical. */
export function conversionMatrixSource(item) {
  const sourceType = {i4: 'int', i8: 'long', r4: 'float', r8: 'double', native: 'nint'}[item.source];
  let input = item.input;
  if (item.source === 'i8') input += 'L';
  if (item.source === 'r4' || item.source === 'r8') input = floatingLiteral(input, sourceType);
  if (item.source === 'native') input = '(nint)(' + input + 'L)';
  const checked = item.opcode.includes('.ovf.');
  const unsigned = item.opcode.endsWith('.un');
  let value = 'value';
  const unsignedType = {i4: 'uint', i8: 'ulong', native: 'nuint'}[item.source];
  if (unsigned && unsignedType) value = `unchecked((${unsignedType})value)`;
  if (!checked && !unsigned && item.source === 'i4' && (item.target === 'ulong' || item.target === 'nuint')) {
    value = 'unchecked((uint)value)';
  }
  if (!checked && !unsigned && item.source === 'native' && item.target === 'ulong') {
    value = 'unchecked((nuint)value)';
  }
  const conversion = `${checked ? 'checked' : 'unchecked'}((${item.target})(${value}))`;
  let print = 'result';
  if (item.target === 'float') print = 'BitConverter.SingleToInt32Bits(result)';
  if (item.target === 'double') print = 'BitConverter.DoubleToInt64Bits(result)';
  if (item.target === 'nint') print = '(long)result';
  if (item.target === 'nuint') print = '(ulong)result';
  const output = ['float', 'double'].includes(item.target) ?
    `if(result!=result)Console.WriteLine("NaN");else Console.WriteLine(${print});` : `Console.WriteLine(${print});`;
  return `{${sourceType} value=${input};try{${item.target} result=${conversion};${output}}` +
    'catch(Exception error){Console.WriteLine("!"+error.GetType().Name);}}';
}
