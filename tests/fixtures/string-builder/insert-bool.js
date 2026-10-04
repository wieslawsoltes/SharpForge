import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

export const insertBooleanParameters = ['int', 'bool'];
const text = units => String.fromCharCode(...units);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Retain typed Boolean locals and aliased getter evaluation before insertion. */
export function builderInsertBooleanSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : `var builder = new StringBuilder(${row.capacity});`];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${JSON.stringify(text(segment))});`);
  lines.push(`bool value = ${row.value};`, 'var alias = builder;');
  const value = row.sourceIndex === null ? 'value' : `alias[${intLiteral(row.sourceIndex)}] != (char)0`;
  lines.push(`var returned = builder.Insert(${intLiteral(row.index)}, ${value});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${JSON.stringify(text(row.after.text))}));`);
  return '{' + lines.join('\n') + '}';
}

/** Emit the exact Boolean MemberRef independently of source overload resolution. */
export function builderInsertBooleanAssembly(row) {
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
      if (row.sourceIndex === null) writer.op('ldc.i4', Number(row.value));
      else writer.op('ldsfld', field).op('ldc.i4', row.sourceIndex)
        .op('callvirt', context.member(builderType, 'get_Chars', 'char', ['int'], false))
        .op('ldc.i4', 0).op('ceq').op('ldc.i4', 0).op('ceq');
      writer.op('callvirt', context.member(builderType, 'Insert', builderType, insertBooleanParameters, false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}

export const booleanInsertionFluentSource = `class Program {
  static int calls;
  static StringBuilder Receiver(StringBuilder builder) { calls = calls * 10 + 1; return builder; }
  static int Index() { calls = calls * 10 + 2; return 1; }
  static bool Value() { calls = calls * 10 + 3; return true; }
  static void Main() {
    var builder = new StringBuilder("ab");
    var returned = Receiver(builder).Insert(Index(), Value()).Insert(0, false).Insert(0, '!').Insert(0, "|");
    Console.WriteLine(calls);
    Console.WriteLine(builder.ToString());
    Console.WriteLine(builder.Length);
    Console.WriteLine(object.ReferenceEquals(builder, returned));
  }
}`;
