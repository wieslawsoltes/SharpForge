import {managedFixture} from '../../managed-fixtures.js';
import {builderType, builderContract} from './append-char.js';

export const insertCharacterParameters = ['int', 'char'];
const text = units => String.fromCharCode(...units);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Use supported constructors while retaining the native input chunk boundaries for managed execution. */
export function createInsertBuilder(platform, row) {
  if (row.segments === null) return null;
  const reference = platform.invoke(builderContract('.ctor', ['int']), [row.capacity]);
  platform.heap.pins.push(reference);
  for (const segment of row.segments) {
    platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string(text(segment))]);
  }
  return reference;
}

/** Preserve a typed Char argument and actual aliased indexer evaluation before mutation. */
export function builderInsertCharacterSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : `var builder = new StringBuilder(${row.capacity});`];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${JSON.stringify(text(segment))});`);
  lines.push('var alias = builder;');
  const value = row.sourceIndex === null ? `(char)${row.value}` : `alias[${intLiteral(row.sourceIndex)}]`;
  lines.push(`var returned = builder.Insert(${intLiteral(row.index)}, ${value});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${JSON.stringify(text(row.after.text))}));`);
  return '{' + lines.join('\n') + '}';
}

/** Direct CIL emits the exact Insert(Int32,Char) MemberRef, independently of source overload resolution. */
export function builderInsertCharacterAssembly(row) {
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
      if (row.sourceIndex === null) writer.op('ldc.i4', row.value).op('conv.u2');
      else writer.op('ldsfld', field).op('ldc.i4', row.sourceIndex)
        .op('callvirt', context.member(builderType, 'get_Chars', 'char', ['int'], false));
      writer.op('callvirt', context.member(builderType, 'Insert', builderType, insertCharacterParameters, false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
