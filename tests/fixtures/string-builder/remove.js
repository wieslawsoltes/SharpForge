import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

const fromUnits = value => String.fromCharCode(...value);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Preserve UTF-16 units through literals and compare content without sending malformed text to stdout. */
export function builderRemoveSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : 'var builder = new StringBuilder(1);'];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${JSON.stringify(fromUnits(segment))});`);
  lines.push(`var returned = builder.Remove(${intLiteral(row.start)}, ${intLiteral(row.length)});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${JSON.stringify(fromUnits(row.after.text))}));`);
  return '{' + lines.join('\n') + '}';
}

/** Independently assemble the released Remove signature, retaining receiver state after a managed fault. */
export function builderRemoveAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 3, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.segments === null) writer.op('ldnull');
      else writer.op('ldc.i4', 1).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
      writer.op('stsfld', field);
      for (const segment of row.segments ?? []) {
        writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(fromUnits(segment)))
          .op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      writer.op('ldsfld', field).op('ldc.i4', row.start).op('ldc.i4', row.length)
        .op('callvirt', context.member(builderType, 'Remove', builderType, ['int', 'int'], false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
