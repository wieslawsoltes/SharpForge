import {managedFixture} from '../../managed-fixtures.js';

const interfaceName = 'System.Collections.IComparer';
const comparerName = 'System.StringComparer';
const int = value => ({type: 'System.Int32', value});
const double = value => ({type: 'System.Double', value});
const bool = value => ({type: 'System.Boolean', value: Number(value)});
const opaque = Object.freeze({type: 'System.Object'});
const shared = Object.freeze({type: 'shared'});

const comparisons = {
  'both-null': [null, null], 'null-first': [null, ''], 'null-second': ['', null], ordinal: ['a', 'A'],
  ints: [int(1), int(2)], doubles: [double(1.5), double(2.5)], bools: [bool(false), bool(true)],
  'different-boxes': [int(1), double(1)], 'number-string': [int(1), '1'], 'string-number': ['1', int(1)],
  'opaque-same': [shared, shared], 'opaque-distinct': [opaque, opaque],
  'nan-equal': [double(NaN), double(NaN)], 'nan-first': [double(NaN), double(0)], 'signed-zero': [double(-0), double(0)]
};

function searchCase(id) {
  if (id.startsWith('search-')) return {type: 'System.String', values: [null, '', 'A', 'a', 'b'],
    key: id === 'search-null' ? null : id.slice('search-'.length)};
  switch (id) {
    case 'empty': return {type: 'System.String', values: [], key: int(1)};
    case 'null-array': return {values: null, key: 'a'};
    case 'int-array': return {type: 'System.Int32', values: [int(1), int(2), int(3)], key: int(2)};
    case 'boxed-array': return {type: 'System.Object', values: [int(1), int(2), int(3)], key: int(2)};
    case 'mixed-search': return {type: 'System.Int32', values: [int(1), int(2), int(3)], key: double(2)};
    case 'string-search-number': return {type: 'System.String', values: ['a'], key: int(2)};
    case 'opaque-search': return {type: 'System.Object', values: [opaque], key: opaque};
    case 'null-comparer': return {type: 'System.Int32', values: [int(1), int(2), int(3)], key: int(2), default: true};
    default: throw new Error('Unmapped native Array comparer case: ' + id);
  }
}

function value(writer, context, item, boxed = true) {
  if (item === null) writer.op('ldnull');
  else if (typeof item === 'string') writer.op('ldstr', 0x70000000 + context.md.userString(item));
  else if (item.type === 'shared') writer.op('ldloc.1');
  else if (item.type === 'System.Object') writer.op('newobj', context.member('System.Object', '.ctor', 'void', [], false));
  else {
    writer.op(item.type === 'System.Double' ? 'ldc.r8' : 'ldc.i4', item.value);
    if (boxed) writer.op('box', context.resolve(item.type));
  }
}

function operation(writer, context, id) {
  const pair = comparisons[id];
  if (pair) {
    writer.op('ldloc.0');
    for (const item of pair) value(writer, context, item);
    writer.op('callvirt', context.member(interfaceName, 'Compare', 'int', ['object', 'object'], false));
    return;
  }
  const source = searchCase(id);
  if (source.values === null) writer.op('ldnull');
  else {
    writer.op('ldc.i4', source.values.length).op('newarr', context.resolve(source.type));
    source.values.forEach((item, index) => {
      writer.op('dup').op('ldc.i4', index);
      value(writer, context, item, source.type === 'System.Object');
      writer.op(source.type === 'System.Int32' ? 'stelem.i4' : 'stelem.ref');
    });
  }
  value(writer, context, source.key);
  writer.op(source.default ? 'ldnull' : 'ldloc.0');
  writer.op('call', context.member('System.Array', 'BinarySearch', 'int', ['System.Array', 'object', interfaceName]));
}

/** Emit captured operations as ordinary CIL, including true interface calls and object construction. */
export function arrayComparerAssembly(id, {innerException = false} = {}) {
  return managedFixture({methods: [{name: 'Main', result: innerException ? 'System.Exception' : 'int',
    locals: [interfaceName, 'object', 'System.Exception'],
    body(writer, context) {
      writer.op('call', context.member(comparerName, 'get_Ordinal', comparerName));
      writer.op('castclass', context.resolve(interfaceName)).op('stloc.0');
      writer.op('newobj', context.member('System.Object', '.ctor', 'void', [], false)).op('stloc.1');
      if (innerException) writer.mark('try');
      operation(writer, context, id);
      if (!innerException) writer.op('ret');
      else {
        writer.op('pop').op('ldnull').op('stloc.2').op('leave', 'done').mark('catch');
        writer.op('callvirt', context.member('System.Exception', 'get_InnerException', 'System.Exception', [], false));
        writer.op('stloc.2').op('leave', 'done').mark('done').op('ldloc.2').op('ret');
      }
    },
    handlers: innerException ? (labels, context) => [{flags: 0,
      start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'), handlerEnd: labels.get('done'),
      catchType: context.resolve('System.InvalidOperationException')
    }] : undefined
  }]});
}
