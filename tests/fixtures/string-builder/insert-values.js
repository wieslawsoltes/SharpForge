import {managedFixture} from '../../managed-fixtures.js';
import {decimalSignature, emitDecimal} from '../../a05-decimal-fixtures.js';
import {builderType} from './append-char.js';
import {decimalLiteral} from './append-decimal.js';
import {int64Literal} from './append-int64.js';
import {singleSourceCases} from './append-single.js';

export const insertionValueTypes = Object.freeze([
  'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'float', 'double', 'decimal', 'object', 'char[]', 'char[]-range'
]);

export const boxedInsertionTypes = Object.freeze({
  sbyte: 'System.SByte', byte: 'System.Byte', short: 'System.Int16', ushort: 'System.UInt16',
  int: 'System.Int32', uint: 'System.UInt32', long: 'System.Int64', ulong: 'System.UInt64',
  float: 'System.Single', double: 'System.Double', decimal: 'System.Decimal', bool: 'System.Boolean', char: 'System.Char'
});

const singleLiterals = new Map(singleSourceCases);
const doubleLiterals = new Map([
  ['0000000000000000', '0d'], ['8000000000000000', '-0d'], ['3fb999999999999a', '0.1d'],
  ['0000000000000001', 'double.Epsilon'], ['7fefffffffffffff', 'double.MaxValue'],
  ['7ff8000000000000', 'double.NaN'], ['7ff0000000000000', 'double.PositiveInfinity'],
  ['fff0000000000000', 'double.NegativeInfinity']
]);
const narrowConversions = Object.freeze({sbyte: 'conv.i1', byte: 'conv.u1', short: 'conv.i2', ushort: 'conv.u2', char: 'conv.u2'});
const text = units => String.fromCharCode(...units);
const quotedText = units => units === null ? 'null' : JSON.stringify(text(units));
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** The range overload has four parameters; every other captured overload has its own exact value parameter. */
export function insertValueParameters(overload, cil = false) {
  if (overload === 'char[]-range') return ['int', 'char[]', 'int', 'int'];
  return ['int', cil && overload === 'decimal' ? decimalSignature : overload];
}

function floatingLiteral(input) {
  const literal = (input.type === 'float' ? singleLiterals : doubleLiterals).get(input.scalar);
  if (literal === undefined) throw new Error('Missing exact floating-point source spelling: ' + input.type + ':' + input.scalar);
  return literal;
}

/** Preserve declared numeric widths and Decimal scale instead of passing source literals through JavaScript Number. */
export function insertValueLiteral(input) {
  switch (input.type) {
    case 'null': return 'null';
    case 'string': return quotedText(input.units);
    case 'char[]': return input.units === null ? 'null' : 'new char[] {' + input.units.map(unit => '(char)' + unit).join(', ') + '}';
    case 'builder': return 'new StringBuilder(' + quotedText(input.units) + ')';
    case 'object': return 'new object()';
    case 'bool': return input.scalar;
    case 'char': return '(char)' + input.scalar;
    case 'long':
    case 'ulong': return int64Literal({type: input.type, input: input.scalar});
    case 'float':
    case 'double': return floatingLiteral(input);
    case 'decimal': return decimalLiteral({coefficient: input.scalar, scale: input.scale, negative: input.negative});
    // The typed local preserves UInt32; the named maximum avoids an out-of-profile positive Int32 token.
    case 'uint': return input.scalar === '4294967295' ? 'uint.MaxValue' : input.scalar;
    case 'sbyte':
    case 'byte':
    case 'short':
    case 'ushort':
    case 'int': return intLiteral(Number(input.scalar));
    default: throw new Error('Unknown insertion source input: ' + input.type);
  }
}

function sourceBuilder(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : `var builder = new StringBuilder(${row.capacity});`];
  for (const segment of row.segments ?? []) lines.push('builder.Append(' + quotedText(segment) + ');');
  return lines;
}

function sourceValue(row) {
  const input = row.input;
  if (input.type === 'probe') return [
    `var probe = new InsertProbe(builder, ${quotedText(input.units)}, ${JSON.stringify(input.scalar)});`,
    'object value = probe;'
  ];
  if (row.overload === 'object' && input.type !== 'null') {
    const type = input.type === 'builder' ? 'StringBuilder' : input.type;
    return [`${type} typedValue = ${insertValueLiteral(input)};`, 'object value = typedValue;'];
  }
  const type = row.overload === 'char[]-range' ? 'char[]' : row.overload;
  return [`${type} value = ${insertValueLiteral(input)};`];
}

function sourceCase(row, index) {
  const lines = [...sourceBuilder(row), ...sourceValue(row), 'string fault = null;', 'bool same = false;'];
  if (row.parameter) lines.push('bool parameterMatches = false;');
  const argumentsList = [intLiteral(row.index), 'value'];
  if (row.overload === 'char[]-range') argumentsList.push(intLiteral(row.startIndex), intLiteral(row.charCount));
  lines.push('try {', `var returned = builder.Insert(${argumentsList.join(', ')});`,
    'same = object.ReferenceEquals(builder, returned);', '} catch (Exception error) {', 'fault = error.GetType().Name;');
  if (row.parameter) {
    const marker = JSON.stringify("(Parameter '" + row.parameter + "')");
    lines.push('parameterMatches = error.Message.Contains(' + marker + ');');
  }
  lines.push('}', 'Console.WriteLine(' + JSON.stringify(row.id) + ');', 'Console.WriteLine(fault);', 'Console.WriteLine(same);');
  if (row.parameter) lines.push('Console.WriteLine(parameterMatches);');
  if (row.after === null) lines.push('Console.WriteLine(builder == null);');
  else lines.push('Console.WriteLine(string.Equals(builder.ToString(), ' + quotedText(row.after.text) + '));',
    'Console.WriteLine(builder.Length);', 'Console.WriteLine(builder.MaxCapacity);');
  lines.push('Console.WriteLine(' + (row.input.type === 'probe' ? 'probe.Calls' : '0') + ');');
  return `static void Case${index}() {\n${lines.join('\n')}\n}`;
}

// The native capture compares exception type, call count and receiver state. Empty Queue.Dequeue supplies the
// same managed InvalidOperationException without adding unsupported typed exception constructors to this batch.
const probeSource = `sealed class InsertProbe {
  readonly StringBuilder builder;
  readonly string text;
  readonly string action;
  public int Calls;
  public InsertProbe(StringBuilder target, string value, string operation) {
    builder = target;
    text = value;
    action = operation;
  }
  public override string ToString() {
    Calls++;
    if (action == "throw") new System.Collections.Generic.Queue<int>().Dequeue();
    if (action == "append" && builder != null) builder.Append("!");
    if (action == "clear" && builder != null) builder.Clear();
    return text;
  }
}`;

/** Each case catches its own failure so all native fault rows execute through real source call sites. */
export function builderInsertValuesSource(rows) {
  const calls = rows.map((row, index) => 'Case' + index + '();').join('\n');
  const methods = rows.map(sourceCase).join('\n');
  return `class Program {\nstatic void Main() {\n${calls}\n}\n${methods}\n}\n` +
    (rows.some(row => row.input.type === 'probe') ? probeSource : '');
}

/** Derive every expected result from captured native rows; never compute insertion output in the fixture. */
export function insertValuesExpectedOutput(rows) {
  const lines = [];
  for (const row of rows) {
    lines.push(row.id, row.fault ?? '', row.identity === true ? 'True' : 'False');
    if (row.parameter) lines.push('True');
    lines.push('True');
    if (row.after !== null) lines.push(String(row.after.length), String(row.after.maxCapacity));
    lines.push(String(row.calls));
  }
  return lines.join('\n') + '\n';
}

/** Keep generated compilations bounded and group exact overloads so selection checks remain easy to diagnose. */
export function insertValueBatches(rows, maximum = 24) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.overload)) groups.set(row.overload, []);
    groups.get(row.overload).push(row);
  }
  const batches = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += maximum) batches.push(group.slice(index, index + maximum));
  }
  return batches;
}

function emitString(writer, context, units) {
  if (units === null) writer.op('ldnull');
  else writer.op('ldstr', 0x70000000 + context.md.userString(text(units)));
}

function emitCharacters(writer, context, units) {
  if (units === null) {
    writer.op('ldnull');
    return;
  }
  writer.op('ldc.i4', units.length).op('newarr', context.resolve('System.Char'));
  for (let index = 0; index < units.length; index++) {
    writer.op('dup').op('ldc.i4', index).op('ldc.i4', units[index]).op('stelem.i2');
  }
}

function emitFloating(writer, context, input) {
  if (input.type === 'float') {
    writer.op('ldc.i4', Number.parseInt(input.scalar, 16) | 0)
      .op('call', context.member('System.BitConverter', 'Int32BitsToSingle', 'float', ['int']));
  } else {
    writer.op('ldc.i8', BigInt.asIntN(64, BigInt('0x' + input.scalar)))
      .op('call', context.member('System.BitConverter', 'Int64BitsToDouble', 'double', ['long']));
  }
}

function emitInput(writer, context, input) {
  switch (input.type) {
    case 'null':
      writer.op('ldnull');
      return;
    case 'string':
      emitString(writer, context, input.units);
      return;
    case 'char[]':
      emitCharacters(writer, context, input.units);
      return;
    case 'builder':
      emitString(writer, context, input.units);
      writer.op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      return;
    case 'object':
      writer.op('newobj', context.member('System.Object', '.ctor', 'void', [], false));
      return;
    case 'float':
    case 'double':
      emitFloating(writer, context, input);
      return;
    case 'decimal':
      emitDecimal(writer, context, input.scalar, input.scale, input.negative);
      return;
    case 'long':
    case 'ulong':
      writer.op('ldc.i8', BigInt.asIntN(64, BigInt(input.scalar)));
      return;
    case 'bool':
      writer.op('ldc.i4', Number(input.scalar === 'true'));
      return;
    case 'sbyte':
    case 'byte':
    case 'short':
    case 'ushort':
    case 'int':
    case 'uint':
    case 'char':
      writer.op('ldc.i4', Number(input.scalar) | 0);
      if (narrowConversions[input.type]) writer.op(narrowConversions[input.type]);
      return;
    default: throw new Error('Unsupported independent CIL insertion input: ' + input.type);
  }
}

function emitBuilder(writer, context, row) {
  const field = 0x04000000 | context.fields.Builder;
  if (row.segments === null) writer.op('ldnull');
  else writer.op('ldc.i4', row.capacity).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
  writer.op('stsfld', field);
  for (const segment of row.segments ?? []) {
    writer.op('ldsfld', field);
    emitString(writer, context, segment);
    writer.op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
  }
  return field;
}

/** Build a real MemberRef for each overload, with CLI-width values and actual box instructions at object boundaries. */
export function builderInsertValuesAssembly(row) {
  if (row.input.type === 'probe') throw new Error('Managed override probes use the source fixture');
  const parameters = insertValueParameters(row.overload, true);
  return managedFixture({name: 'BuilderInsertValues', fields: [
    {name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}, {name: 'Value', type: parameters[1]}
  ], methods: [{name: 'Main', result: 'void', maxStack: 5, body(writer, context) {
    const builder = emitBuilder(writer, context, row);
    const value = 0x04000000 | context.fields.Value;
    emitInput(writer, context, row.input);
    if (row.overload === 'object' && boxedInsertionTypes[row.input.type]) {
      writer.op('box', context.resolve(boxedInsertionTypes[row.input.type]));
    }
    writer.op('stsfld', value).op('ldsfld', builder).op('ldc.i4', row.index).op('ldsfld', value);
    if (row.overload === 'char[]-range') writer.op('ldc.i4', row.startIndex).op('ldc.i4', row.charCount);
    writer.op('callvirt', context.member(builderType, 'Insert', builderType, parameters, false));
    writer.op('ldsfld', builder).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
  }}]});
}

export const insertionValuesFluentSource = `class Program {
  static int calls;
  static StringBuilder Receiver(StringBuilder builder) { calls = calls * 10 + 1; return builder; }
  static int Index() { calls = calls * 10 + 2; return 1; }
  static int Number() { calls = calls * 10 + 3; return -42; }
  static void Main() {
    var builder = new StringBuilder("ab");
    var returned = Receiver(builder).Insert(Index(), Number());
    Console.WriteLine(calls);
    Console.WriteLine(builder.ToString());
    Console.WriteLine(builder.Length);
    Console.WriteLine(object.ReferenceEquals(builder, returned));
  }
}`;
