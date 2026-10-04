import {managedFixture} from '../../managed-fixtures.js';
import {builderType, builderContract} from './append-char.js';

export const replaceParameters = row => row.ranged ? ['char', 'char', 'int', 'int'] : ['char', 'char'];
export const replaceArguments = row => row.ranged ? [row.oldChar, row.newChar, row.start, row.count] : [row.oldChar, row.newChar];
const fromUnits = value => String.fromCharCode(...value);
const intLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Construct only released builders and pin them through the caller's withRoots scope. */
export function createEditBuilder(platform, segments) {
  if (segments === null) return null;
  const value = platform.invoke(builderContract('.ctor', ['int']), [1]);
  platform.heap.pins.push(value);
  for (const segment of segments) {
    platform.invoke(builderContract('Append', ['string']), [value, platform.heap.string(fromUnits(segment))]);
  }
  return value;
}

/** Use exact char arguments and print ordinal content equality so malformed UTF-16 never crosses stdout. */
export function builderReplaceSource(row) {
  const lines = [row.segments === null ? 'StringBuilder builder = null;' : 'var builder = new StringBuilder(1);'];
  for (const segment of row.segments ?? []) lines.push(`builder.Append(${JSON.stringify(fromUnits(segment))});`);
  const args = [`(char)${row.oldChar}`, `(char)${row.newChar}`];
  if (row.ranged) args.push(intLiteral(row.start), intLiteral(row.count));
  lines.push(`var returned = builder.Replace(${args.join(',')});`);
  lines.push('Console.WriteLine(object.ReferenceEquals(builder, returned));');
  if (row.after) lines.push(`Console.WriteLine(string.Equals(builder.ToString(), ${JSON.stringify(fromUnits(row.after.text))}));`);
  return '{' + lines.join('\n') + '}';
}

/** Independent CIL calls the native overloads directly, preserving builder state even when the call faults. */
export function builderReplaceAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 5, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.segments === null) writer.op('ldnull');
      else writer.op('ldc.i4', 1).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
      writer.op('stsfld', field);
      for (const segment of row.segments ?? []) {
        writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(fromUnits(segment)))
          .op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      writer.op('ldsfld', field).op('ldc.i4', row.oldChar).op('conv.u2').op('ldc.i4', row.newChar).op('conv.u2');
      if (row.ranged) writer.op('ldc.i4', row.start).op('ldc.i4', row.count);
      writer.op('callvirt', context.member(builderType, 'Replace', builderType, replaceParameters(row), false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
