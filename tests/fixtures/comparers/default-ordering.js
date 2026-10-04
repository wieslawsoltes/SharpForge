import {managedFixture} from '../../managed-fixtures.js';

/** Exercise default List/Array ordering and both BinarySearch overloads as independently assembled CIL. */
export function defaultOrderingAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'void', locals: ['string[]'], body(writer, context) {
    const text = value => writer.op('ldstr', 0x70000000 + context.md.userString(value));
    const array = values => {
      writer.op('ldc.i4', values.length).op('newarr', context.resolve('System.String'));
      values.forEach((value, index) => {
        writer.op('dup').op('ldc.i4', index);
        text(value);
        writer.op('stelem.ref');
      });
    };
    const writeString = context.member('System.Console', 'WriteLine', 'void', ['string']);
    const writeInt = context.member('System.Console', 'WriteLine', 'void', ['int']);
    const list = 'System.Collections.Generic.List`1<string>';
    array(['b', 'A', 'a']);
    writer.op('newobj', context.member(list, '.ctor', 'void', ['string[]'], false)).op('dup');
    writer.op('callvirt', context.member(list, 'Sort', 'void', [], false));
    writer.op('callvirt', context.member(list, 'ToArray', 'string[]', [], false)).op('stloc.0');
    for (let index = 0; index < 3; index++) {
      writer.op('ldloc.0').op('ldc.i4', index).op('ldelem.ref').op('call', writeString);
    }
    array(['b', 'A', 'a']);
    writer.op('stloc.0').op('ldloc.0').op('call', context.member('System.Array', 'Sort', 'void', ['System.Array']));
    for (let index = 0; index < 3; index++) {
      writer.op('ldloc.0').op('ldc.i4', index).op('ldelem.ref').op('call', writeString);
    }
    for (const comparer of ['typed', 'default', 'ordinal']) {
      array(['ab']);
      text('a\0b');
      if (comparer === 'typed') {
        writer.op('call', context.member('System.Array', 'BinarySearch', 'int', ['string[]', 'string']));
      } else {
        if (comparer === 'default') writer.op('ldnull');
        else writer.op('call', context.member('System.StringComparer', 'get_Ordinal', 'System.StringComparer'));
        writer.op('call', context.member('System.Array', 'BinarySearch', 'int',
          ['System.Array', 'object', 'System.Collections.IComparer']));
      }
      writer.op('call', writeInt);
    }
    writer.op('ret');
  }}]});
}
