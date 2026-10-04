import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

export const insertRepeatParameters = ['int', 'string', 'int'];
const text = units => String.fromCharCode(...units);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Keep the string argument typed so null selects the exact repeated insertion overload. */
export function builderInsertRepeatSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : `var builder = new StringBuilder(${row.capacity});`];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${JSON.stringify(text(segment))});`);
  lines.push(`string value = ${row.value === null ? 'null' : JSON.stringify(text(row.value))};`);
  lines.push(`var returned = builder.Insert(${intLiteral(row.index)}, value, ${intLiteral(row.count)});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${JSON.stringify(text(row.after.text))}));`);
  return '{' + lines.join('\n') + '}';
}

/** Call the exact CLR MemberRef independently of source binding and overload selection. */
export function builderInsertRepeatAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 4, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.segments === null) writer.op('ldnull');
      else writer.op('ldc.i4', row.capacity).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
      writer.op('stsfld', field);
      for (const segment of row.segments ?? []) writer.op('ldsfld', field)
        .op('ldstr', 0x70000000 + context.md.userString(text(segment)))
        .op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      writer.op('ldsfld', field).op('ldc.i4', row.index);
      if (row.value === null) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(text(row.value)));
      writer.op('ldc.i4', row.count).op('callvirt', context.member(builderType, 'Insert', builderType, insertRepeatParameters, false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}

export const repeatedInsertionFluentSource = `class Program {
  static int calls;
  static StringBuilder Receiver(StringBuilder builder) { calls = calls * 10 + 1; return builder; }
  static int Index() { calls = calls * 10 + 2; return 1; }
  static string Value() { calls = calls * 10 + 3; return "xy"; }
  static int Count() { calls = calls * 10 + 4; return 2; }
  static void Main() {
    var builder = new StringBuilder("ab");
    var returned = Receiver(builder).Insert(Index(), Value(), Count());
    Console.WriteLine(calls); Console.WriteLine(builder.ToString()); Console.WriteLine(builder.Length);
    Console.WriteLine(object.ReferenceEquals(builder, returned));
  }
}`;
