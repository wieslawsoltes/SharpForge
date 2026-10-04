import {managedFixture} from '../../managed-fixtures.js';

const comparerName = 'System.StringComparer';
const interfaceName = 'System.Collections.Generic.IComparer`1<string>';
const listName = 'System.Collections.Generic.List`1<string>';

/** Execute interface dispatch and casts in ordinary CIL, independently of source-profile guards. */
export function ordinalInterfaceAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'void', locals: [interfaceName, listName], body(writer, context) {
    const text = value => writer.op('ldstr', 0x70000000 + context.md.userString(value));
    const writeString = context.member('System.Console', 'WriteLine', 'void', ['string']);
    const writeBool = context.member('System.Console', 'WriteLine', 'void', ['bool']);
    const ordinal = context.member(comparerName, 'get_Ordinal', comparerName);
    const compare = context.member(interfaceName, 'Compare', 'int', ['string', 'string'], false);
    writer.op('call', ordinal).op('castclass', context.resolve(interfaceName)).op('stloc.0');
    const values = ['b', 'A', 'a', null, '', 'A'];
    writer.op('ldc.i4', values.length).op('newarr', context.resolve('System.String'));
    values.forEach((value, index) => {
      writer.op('dup').op('ldc.i4', index);
      if (value === null) writer.op('ldnull');
      else text(value);
      writer.op('stelem.ref');
    });
    writer.op('newobj', context.member(listName, '.ctor', 'void', ['string[]'], false)).op('stloc.1');
    writer.op('ldloc.1').op('ldloc.0').op('callvirt', context.member(listName, 'Sort', 'void', [interfaceName], false));
    for (let index = 0; index < values.length; index++) {
      writer.op('ldloc.1').op('ldc.i4', index).op('callvirt', context.member(listName, 'get_Item', 'string', ['int'], false));
      writer.op('dup').op('brtrue', 'write' + index).op('pop');
      text('<null>');
      writer.mark('write' + index).op('call', writeString);
    }
    writer.op('ldloc.0'); text('a'); text('A');
    writer.op('callvirt', compare).op('ldc.i4.0').op('cgt').op('call', writeBool);
    writer.op('call', ordinal).op('call', ordinal).op('ceq').op('call', writeBool);
    writer.op('call', ordinal).op('isinst', context.resolve(interfaceName)).op('ldnull').op('cgt.un').op('call', writeBool);
    writer.op('call', ordinal).op('castclass', context.resolve(interfaceName)).op('ldnull'); text('');
    writer.op('callvirt', compare).op('ldc.i4.0').op('clt').op('call', writeBool).op('ret');
  }}]});
}
