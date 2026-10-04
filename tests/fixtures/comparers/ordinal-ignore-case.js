import {managedFixture} from '../../managed-fixtures.js';

const comparerType = 'System.StringComparer';
const stringInterface = 'System.Collections.Generic.IComparer`1<string>';
const objectInterface = 'System.Collections.IComparer';
const listType = 'System.Collections.Generic.List`1<string>';

export const fromUnits = value => value === null ? null : String.fromCharCode(...value);

function text(writer, context, units) {
  if (units === null) writer.op('ldnull');
  else writer.op('ldstr', 0x70000000 + context.md.userString(fromUnits(units)));
}

function array(writer, context, values) {
  writer.op('ldc.i4', values.length).op('newarr', context.resolve('System.String'));
  values.forEach((units, index) => {
    writer.op('dup').op('ldc.i4', index);
    text(writer, context, units);
    writer.op('stelem.ref');
  });
}

function compare(writer, context, {owner, parameters, first, second}) {
  writer.op('ldloc.0').op('castclass', context.resolve(owner));
  text(writer, context, first);
  text(writer, context, second);
  writer.op('callvirt', context.member(owner, 'Compare', 'int', parameters, false)).op('stloc.1');
  writer.op('ldloc.1').op('ldc.i4.0').op('cgt').op('ldloc.1').op('ldc.i4.0').op('clt').op('sub');
  writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
}

/** Exercise real string/object interface calls, casts, sorting and searching without the source compiler. */
export function ordinalIgnoreCaseAssembly(reference) {
  return managedFixture({methods: [{name: 'Main', result: 'void', locals: [comparerType, 'int', listType], body(writer, context) {
    writer.op('call', context.member(comparerType, 'get_OrdinalIgnoreCase', comparerType)).op('stloc.0');
    const routes = [
      [comparerType, ['string', 'string']], [stringInterface, ['string', 'string']],
      [comparerType, ['object', 'object']], [objectInterface, ['object', 'object']]
    ];
    for (const [owner, parameters] of routes) {
      for (let index = 0; index + 1 < reference.values.length; index += 2) {
        compare(writer, context, {owner, parameters, first: reference.values[index], second: reference.values[index + 1]});
      }
    }
    array(writer, context, reference.input);
    writer.op('newobj', context.member(listType, '.ctor', 'void', ['string[]'], false)).op('stloc.2');
    writer.op('ldloc.2').op('ldloc.0').op('castclass', context.resolve(stringInterface));
    writer.op('callvirt', context.member(listType, 'Sort', 'void', [stringInterface], false));
    for (const row of reference.searches) {
      writer.op('ldloc.2').op('callvirt', context.member(listType, 'ToArray', 'string[]', [], false));
      text(writer, context, row.key);
      writer.op('ldloc.0').op('castclass', context.resolve(objectInterface));
      writer.op('call', context.member('System.Array', 'BinarySearch', 'int', ['System.Array', 'object', objectInterface]));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
    }
    writer.op('ldloc.0').op('isinst', context.resolve(stringInterface)).op('ldnull').op('cgt.un');
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['bool'])).op('ret');
  }}]});
}
