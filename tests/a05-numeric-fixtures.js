import {managedFixture} from './managed-fixtures.js';

// Explicit .NET 10 conversion results, expressed as public values (not stack
// bit patterns). Reused by JS regression tests and the native .NET comparison.
export const floatingConversionCases = [
  ['i8', [
    [1e30, 9223372036854775807n], [-1e30, -9223372036854775808n],
    [NaN, 0n], [Infinity, 9223372036854775807n], [-Infinity, -9223372036854775808n],
    [2 ** 63 - 1024, 9223372036854774784n], [2 ** 63, 9223372036854775807n],
    [-(2 ** 63) - 2048, -9223372036854775808n], [3.9, 3n], [-3.9, -3n],
  ]],
  ['u8', [
    [1e30, 18446744073709551615n], [-1e30, 0n], [NaN, 0n], [Infinity, 18446744073709551615n], [-Infinity, 0n],
    [2 ** 64 - 2048, 18446744073709549568n], [2 ** 64, 18446744073709551615n], [3.9, 3n], [-3.9, 0n],
  ]],
  ['u4', [
    [1e30, 4294967295], [-1e30, 0], [NaN, 0], [Infinity, 4294967295], [-Infinity, 0],
    [3e9, 3000000000], [4294967295.9, 4294967295], [4294967296, 4294967295], [-0.9, 0], [-1, 0], [3.9, 3],
  ]],
  ['i4', [
    [1e30, 2147483647], [-1e30, -2147483648], [NaN, 0], [Infinity, 2147483647], [-Infinity, -2147483648],
    [2147483647.9, 2147483647], [2147483648, 2147483647], [-2147483648.9, -2147483648], [-0, 0], [-3.9, -3],
  ]],
  ['i2', [
    [1e30, -1], [-1e30, 0], [NaN, 0], [Infinity, -1], [-Infinity, 0],
    [32767.9, 32767], [32768, -32768], [65535, -1], [65536, 0], [-32769, 32767], [3e9, -1], [-3e9, 0],
  ]],
  ['i1', [
    [1e30, -1], [-1e30, 0], [NaN, 0], [Infinity, -1], [-Infinity, 0],
    [127.9, 127], [128, -128], [255, -1], [256, 0], [-129, 127],
  ]],
  ['u1', [
    [1e30, 255], [-1e30, 0], [NaN, 0], [Infinity, 255], [-Infinity, 0], [255.9, 255], [256, 0], [-1.9, 255],
  ]],
  ['u2', [
    [1e30, 65535], [-1e30, 0], [NaN, 0], [Infinity, 65535], [-Infinity, 0], [65535.9, 65535], [65536, 0], [-1.9, 65535],
  ]],
].flatMap(([target, cases]) => cases.map(([input, expected], index) => ({id: `${target}_${index}`, source: 'double', target, input, expected})));

floatingConversionCases.push(
  {id: 'single_i8_overflow', source: 'float', target: 'i8', input: 1e30, expected: 9223372036854775807n},
  {id: 'single_u8_negative', source: 'float', target: 'u8', input: -1e30, expected: 0n},
  {id: 'single_i8_precision', source: 'float', target: 'i8', input: 16777217, expected: 16777216n},
  {id: 'single_u4_rounding', source: 'float', target: 'u4', input: 4294967295, expected: 4294967295},
  {id: 'single_i2_overflow', source: 'float', target: 'i2', input: 1e30, expected: -1},
  {id: 'single_i1_nan', source: 'float', target: 'i1', input: NaN, expected: 0},
);

export const wideningConversionCases = [
  {id: 'uint_max_to_ulong', source: 'uint', target: 'u8', input: -1, expected: 4294967295n},
  {id: 'uint_high_bit_to_ulong', source: 'uint', target: 'u8', input: -2147483648, expected: 2147483648n},
  {id: 'uint_zero_to_ulong', source: 'uint', target: 'u8', input: 0, expected: 0n},
  {id: 'int_negative_to_long', source: 'int', target: 'i8', input: -1, expected: -1n},
  {id: 'int_min_to_long', source: 'int', target: 'i8', input: -2147483648, expected: -2147483648n},
  {id: 'long_negative_to_ulong', source: 'long', target: 'u8', input: -1n, expected: 18446744073709551615n},
];

export const conversionReturnType = {i1: 'int', u1: 'int', i2: 'int', u2: 'int', i4: 'int', u4: 'uint', i8: 'long', u8: 'ulong'};
export const numericConversionCases = [...wideningConversionCases, ...floatingConversionCases];
export const numericConversionOutput = numericConversionCases.map(c => String(c.expected) + '\n').join('');

// The shared fixture builder's source-profile writer does not emit unsigned or
// single-precision primitive signatures. Use genuine CLI element types here:
// native .NET must not see class references named "uint", "ulong", or "float".
const primitiveSignature = (result, parameters) => {
  const element = {void: 0x01, int: 0x08, uint: 0x09, long: 0x0a, ulong: 0x0b, float: 0x0c, double: 0x0d};
  return Uint8Array.of(0, parameters.length, element[result], ...parameters.map(type => element[type]));
};

/** Identical authored IL can run on the direct VM and the native .NET JIT.
 * NoInlining keeps conversion inputs dynamic so JIT constant folding cannot
 * replace the float-to-small-integer path this compatibility table describes.
 */
export function numericConversionFixture(cases = numericConversionCases) {
  return managedFixture({
    name: 'A05NumericConversions',
    methods: [
      {name: 'Main', result: 'void', body(w, c) {
        for (const item of cases) {
          w.op(item.source === 'double' ? 'ldc.r8' : item.source === 'float' ? 'ldc.r4' : item.source === 'long' ? 'ldc.i8' : 'ldc.i4', item.input);
          const writeLine = c.md.member(c.md.typeRef('System.Console'), 'WriteLine', primitiveSignature('void', [conversionReturnType[item.target]]));
          w.op('call', c.methods[item.id]).op('call', writeLine);
        }
        w.op('ret');
      }},
      ...cases.map(item => ({name: item.id, parameters: [item.source], result: conversionReturnType[item.target], signature: primitiveSignature(conversionReturnType[item.target], [item.source]), body: w => w.op('ldarg.0').op('conv.' + item.target).op('ret')})),
    ],
    decorate(c) { for (const row of c.md.rows[6]) row[1] |= 8; },
  });
}
