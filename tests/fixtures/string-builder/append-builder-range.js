import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';
import {emitBuilder} from './append-builder.js';

export const builderRangeParameters = [builderType, 'int', 'int'];

/** Call the exact ranged builder overload in ordinary CIL, with self identity and native signed indices. */
export function builderRangeAssembly(row) {
  return managedFixture({fields: [{name: 'Destination', type: builderType}, {name: 'Source', type: builderType},
    {name: 'Same', type: 'bool'}], methods: [{name: 'Main', result: 'void', maxStack: 4, body(writer, context) {
      const destination = 0x04000000 | context.fields.Destination;
      const source = 0x04000000 | context.fields.Source;
      emitBuilder(writer, context, destination, row.nullReceiver ? null : row.destination);
      if (row.self) writer.op('ldsfld', destination).op('stsfld', source);
      else emitBuilder(writer, context, source, row.source);
      writer.op('ldsfld', destination).op('ldsfld', source).op('ldc.i4', row.startIndex).op('ldc.i4', row.count);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, builderRangeParameters, false));
      writer.op('ldsfld', destination).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}

function sourceBuilder(name, segments) {
  if (segments === null) return `StringBuilder ${name} = null;`;
  return `var ${name} = new StringBuilder();\n` + segments.map(units =>
    `${name}.Append(${JSON.stringify(String.fromCharCode(...units))});`).join('\n');
}

/** Generate ordinary typed calls from unchanged native rows, preserving explicit null source types. */
export function builderRangeSource(rows) {
  return rows.map((row, index) => {
    const destination = 'destination' + index;
    const source = 'source' + index;
    return sourceBuilder(destination, row.nullReceiver ? null : row.destination) + '\n' +
      (row.self ? `StringBuilder ${source} = ${destination};` : sourceBuilder(source, row.source)) + `
      try {
        var returned${index} = ${destination}.Append(${source}, ${row.startIndex}, ${row.count});
        Console.WriteLine(object.ReferenceEquals(${destination}, returned${index}));
      } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      if (${destination} != null) {
        string text${index} = ${destination}.ToString();
        Console.WriteLine(text${index}.Length);
        for (int unit = 0; unit < text${index}.Length; unit++) Console.WriteLine((int)text${index}[unit]);
      }`;
  }).join('\n');
}
