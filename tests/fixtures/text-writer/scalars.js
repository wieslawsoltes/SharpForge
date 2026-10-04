import {readFileSync} from 'node:fs';
import {decimal} from '@sharpforge/bytecode';
import {managedFixture} from '../../managed-fixtures.js';
import {decimalSignature, emitDecimal} from '../../a05-decimal-fixtures.js';
import {writerType, parentType} from './engines.js';

export const scalarTypes = ['bool', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal'];
const directory = new URL('../../../packages/bcl-core/reference/', import.meta.url);
export const scalarReferences = [
  'string-builder-append-integers', 'string-builder-append-int64', 'string-builder-append-single',
  'string-builder-append-decimal', 'double-format'
].map(name => ({name, directory, capture: JSON.parse(readFileSync(new URL(name + '-net10.json', directory), 'utf8'))}));
const [integers, int64, single, decimals, doubles] = scalarReferences.map(reference => reference.capture);

function fromBits(bits, width) {
  const bytes = new DataView(new ArrayBuffer(8));
  if (width === 32) {
    bytes.setUint32(0, Number.parseInt(bits, 16));
    return bytes.getFloat32(0);
  }
  bytes.setBigUint64(0, BigInt('0x' + bits));
  return bytes.getFloat64(0);
}

function integerCase(row) {
  const wide = row.type === 'long' || row.type === 'ulong';
  const suffix = {uint: 'U', long: 'L', ulong: 'UL'}[row.type] ?? '';
  return {id: row.type + ':' + row.input, type: row.type, value: wide ? BigInt(row.input) : Number(row.input),
    text: row.output.slice(row.initial.length),
    source: row.type === 'long' && row.input === '-9223372036854775808' ? 'long.MinValue' : row.input + suffix};
}

const singleSources = new Map([
  ['00000000', '0f'], ['80000000', '-0f'], ['3dcccccd', '0.1f'],
  ['4e6e6b28', '1000000000f'], ['4e6e6b29', '1.00000006E+09f'],
  ['00000001', 'float.Epsilon'], ['7f7fffff', 'float.MaxValue'], ['ff7fffff', 'float.MinValue'],
  ['7fc00000', 'float.NaN'], ['7f800000', 'float.PositiveInfinity'], ['ff800000', 'float.NegativeInfinity']
]);

function doubleSource(row) {
  if (row.name === 'nan') return 'double.NaN';
  if (row.name === 'positive-infinity') return 'double.PositiveInfinity';
  if (row.name === 'negative-infinity') return 'double.NegativeInfinity';
  return row.output[''] + 'd';
}

function decimalCase(row) {
  const digits = row.coefficient.padStart(row.scale + 1, '0');
  const text = row.scale ? digits.slice(0, -row.scale) + '.' + digits.slice(-row.scale) : digits;
  return {id: 'decimal:' + row.bits.join(','), type: 'decimal',
    value: decimal(BigInt(row.coefficient), row.scale, row.negative), text: row.text,
    coefficient: row.coefficient, scale: row.scale, negative: row.negative,
    source: (row.negative ? '-' : '') + text + 'm'};
}

/** Restore one independently captured native input without losing its declared width or Decimal representation. */
export function capturedScalar(row) {
  const {type, input} = row;
  if (type === 'decimal') {
    const [low, middle, high, flags] = input.bits;
    const coefficient = BigInt(low >>> 0) | BigInt(middle >>> 0) << 32n | BigInt(high >>> 0) << 64n;
    const scale = flags >>> 16 & 255;
    const negative = flags < 0;
    return {id: row.id, type, coefficient: String(coefficient), scale, negative,
      value: decimal(coefficient, scale, negative), text: input.text};
  }
  if (type === 'float' || type === 'double') {
    return {id: row.id, type, bits: input.bits, value: fromBits(input.bits, type === 'float' ? 32 : 64), text: input.text};
  }
  const value = type === 'bool' ? input.text === 'True' :
    type === 'long' || type === 'ulong' ? BigInt(input.text) : Number(input.text);
  return {id: row.id, type, value, text: input.text};
}

// Native scalar text is reused from the named core captures; these are not new StringWriter captures.
// Boolean and Int32 rows are explicit specification expectations, also covered by the separate native writer capture.
export const scalarCases = [
  ...[false, true].map(value => ({id: 'bool:' + value, type: 'bool', value,
    text: value ? 'True' : 'False', source: String(value)})),
  ...[-2147483648, -1, 0, 1, 2147483647].map(value => ({id: 'int:' + value, type: 'int', value,
    text: String(value), source: value === -2147483648 ? 'int.MinValue' : String(value)})),
  ...integers.rows.filter(row => row.type === 'uint' && !row.nullReceiver && row.initial === 'seed|').map(integerCase),
  ...int64.rows.filter(row => !row.nullReceiver && row.initial === 'seed|').map(integerCase),
  ...single.rows.filter(row => !row.nullReceiver).map(row => ({id: 'float:' + row.bits, type: 'float', bits: row.bits,
    value: fromBits(row.bits, 32), text: row.text, source: singleSources.get(row.bits)})),
  ...doubles.rows.map(row => ({id: 'double:' + row.name, type: 'double', bits: row.bits,
    value: fromBits(row.bits, 64), text: row.output[''], source: doubleSource(row)})),
  ...decimals.rows.filter(row => !row.nullReceiver).map(decimalCase)
];

function emitScalar(writer, context, row) {
  if (row.type === 'decimal') {
    emitDecimal(writer, context, row.coefficient, row.scale, row.negative);
  } else if (row.type === 'float') {
    writer.op('ldc.i4', Number.parseInt(row.bits, 16) | 0);
    writer.op('call', context.member('System.BitConverter', 'Int32BitsToSingle', 'float', ['int']));
  } else if (row.type === 'double') {
    writer.op('ldc.i8', BigInt.asIntN(64, BigInt('0x' + row.bits)));
    writer.op('call', context.member('System.BitConverter', 'Int64BitsToDouble', 'double', ['long']));
  } else if (row.type === 'long' || row.type === 'ulong') {
    writer.op('ldc.i8', BigInt.asIntN(64, row.value));
  } else writer.op('ldc.i4', Number(row.value) | 0);
}

/** Independently emit typed CIL calls; I4/I8 bit patterns and Decimal words never pass through Double. */
export function scalarWriterAssembly(rows, {method = 'Write', baseView = false, nullWriter = false,
  disposed = false, newLine = '~', delimiter = '|'} = {}) {
  const owner = baseView ? parentType : writerType;
  return managedFixture({fields: [{name: 'Writer', type: owner}],
    methods: [{name: 'Main', result: 'void', maxStack: 6, body(writer, context) {
      const field = 0x04000000 | context.fields.Writer;
      const call = (name, parameters = []) => writer.op('callvirt', context.member(owner, name, 'void', parameters, false));
      if (nullWriter) writer.op('ldnull');
      else writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false)).op('castclass', context.resolve(owner));
      writer.op('stsfld', field);
      if (!nullWriter) {
        writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString('seed|'));
        call('Write', ['string']);
        writer.op('ldsfld', field);
        if (newLine === null) writer.op('ldnull');
        else writer.op('ldstr', 0x70000000 + context.md.userString(newLine));
        call('set_NewLine', ['string']);
        if (disposed) {
          writer.op('ldsfld', field);
          call('Dispose');
        }
      }
      for (const row of rows) {
        writer.op('ldsfld', field);
        emitScalar(writer, context, row);
        call(method, [row.type === 'decimal' ? decimalSignature : row.type]);
        if (delimiter !== null) {
          writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(delimiter));
          call('Write', ['string']);
        }
      }
      writer.op('ret');
    }}]});
}
