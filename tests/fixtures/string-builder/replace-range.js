import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

const fromUnits = value => String.fromCharCode(...value);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);
const literal = value => value === null ? 'null' : JSON.stringify(fromUnits(value));

/** Bind native string parameters explicitly, preserving UTF-16 units without malformed stdout. */
export function builderReplaceRangeSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : 'var builder = new StringBuilder(1);'];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${literal(segment)});`);
  lines.push(`string oldValue = ${literal(row.oldValue)}; string newValue = ${literal(row.newValue)};`);
  lines.push(`var returned = builder.Replace(oldValue, newValue, ${intLiteral(row.start)}, ${intLiteral(row.count)});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${literal(row.after.text)}));`);
  return '{' + lines.join('\n') + '}';
}

function loadString(writer, context, units) {
  if (units === null) writer.op('ldnull');
  else writer.op('ldstr', 0x70000000 + context.md.userString(fromUnits(units)));
}

/** Independently call the exact CLR signature while retaining the receiver after a fault. */
export function builderReplaceRangeAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 5, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.segments === null) writer.op('ldnull');
      else writer.op('ldc.i4', 1).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
      writer.op('stsfld', field);
      for (const segment of row.segments ?? []) {
        writer.op('ldsfld', field);
        loadString(writer, context, segment);
        writer.op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      writer.op('ldsfld', field);
      loadString(writer, context, row.oldValue);
      loadString(writer, context, row.newValue);
      writer.op('ldc.i4', row.start).op('ldc.i4', row.count)
        .op('callvirt', context.member(builderType, 'Replace', builderType, ['string', 'string', 'int', 'int'], false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
