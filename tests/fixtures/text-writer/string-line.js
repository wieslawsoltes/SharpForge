import {managedFixture} from '../../managed-fixtures.js';
import {writerType, parentType} from './engines.js';

export const units = value => value.split('').map(unit => unit.charCodeAt(0));
export const fromUnits = value => value === null ? null : String.fromCharCode(...value);

/** Build independent concrete/base CIL calls from ordinary native string rows. */
export function stringWriterAssembly(row) {
  const owner = row.baseView ? parentType : writerType;
  return managedFixture({fields: [{name: 'Writer', type: owner}],
    methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      const field = 0x04000000 | context.fields.Writer;
      const call = (name, parameters = []) => writer.op('callvirt', context.member(owner, name, 'void', parameters, false));
      const text = value => value === null ? writer.op('ldnull') :
        writer.op('ldstr', 0x70000000 + context.md.userString(value));
      if (row.receiverState === 'null') writer.op('ldnull');
      else writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false)).op('castclass', context.resolve(owner));
      writer.op('stsfld', field);
      if (row.receiverState !== 'null') {
        writer.op('ldsfld', field);
        text('seed|');
        call('Write', ['string']);
        if (row.setNewLine) {
          writer.op('ldsfld', field);
          text(fromUnits(row.requestedNewLine));
          call('set_NewLine', ['string']);
        }
        if (row.receiverState === 'disposed') {
          writer.op('ldsfld', field);
          call('Dispose');
        }
      }
      writer.op('ldsfld', field);
      text(fromUnits(row.value));
      call(row.operation, ['string']);
      writer.op('ret');
    }}]});
}

/** Compile representative native rows as real bound/legacy source calls. */
export function stringWriterSource(rows) {
  const bodies = rows.map(row => {
    const absent = row.receiverState === 'null';
    return `{
      StringWriter concrete = ${absent ? 'null' : 'new StringWriter()'};
      ${row.baseView ? 'TextWriter' : 'StringWriter'} view = concrete;
      string value = ${JSON.stringify(fromUnits(row.value))};
      ${absent ? '' : 'concrete.Write("seed|");'}
      ${!absent && row.setNewLine ? `view.NewLine = ${JSON.stringify(fromUnits(row.requestedNewLine))};` : ''}
      ${row.receiverState === 'disposed' ? 'view.Dispose();' : ''}
      try { view.${row.operation}(value); Console.WriteLine("none"); }
      catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      Console.WriteLine(${absent ? '"<null>"' : 'concrete.ToString()'});
    }`;
  });
  return {source: 'using System; using System.IO; ' + bodies.join('\n'),
    expected: rows.map(row => (row.fault ?? 'none') + '\n' + (fromUnits(row.output) ?? '<null>') + '\n').join('')};
}
