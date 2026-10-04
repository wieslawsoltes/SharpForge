import { methodSignature } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

const constrained = context => ({ name: 'constrained.', operand: context.resolve('System.Int32') });
const readonly = { name: 'readonly.' };
const stringify = context => context.member('System.Object', 'ToString', 'string', [], false);
const valueCall = (name, target = 'callvirt', duplicate = false) => ({
  name, parameters: ['int'], result: 'string', body(writer, context) {
    const prefix = constrained(context);
    writer.op('ldarga.s', 0).group(target, stringify(context), duplicate ? [prefix, prefix] : [prefix]).op('ret');
  },
});
const arrayRead = (name, duplicate = false, store = false) => ({
  name, parameters: ['int[]'], result: store ? 'void' : 'int', body(writer, context) {
    writer.op('ldarg.0').op('ldc.i4.0').group('ldelema', context.resolve('System.Int32'), duplicate ? [readonly, readonly] : [readonly]);
    if (store) writer.op('ldc.i4.0').op('stind.i4');
    else writer.op('ldind.i4');
    writer.op('ret');
  },
});

export const cases = [
  { method: valueCall('Constrained'), diagnostic: null },
  { method: arrayRead('Readonly'), diagnostic: null },
  { method: valueCall('BadConstrained', 'call'), diagnostic: 'CILPC0002' },
  { method: { name: 'BadReadonly', body: writer => writer.group('nop', undefined, [readonly]).op('ret') }, diagnostic: 'CILPC0003' },
  { method: valueCall('RepeatedConstrained', 'callvirt', true), diagnostic: 'CILPC0001' },
  { method: arrayRead('RepeatedReadonly', true), diagnostic: 'CILPC0001' },
  { method: {
    name: 'MissingType', parameters: ['int'], result: 'string', body: (writer, context) => writer.op('ldarga.s', 0)
      .group('callvirt', stringify(context), [{ name: 'constrained.', operand: 0x0100ffff }]).op('ret'),
  }, diagnostic: 'CILPC0004' },
  // These are deliberate partial-scope cases: preserve their actual native decisions, including disagreement.
  { method: arrayRead('ReadonlyStore', false, true), diagnostic: null },
  { method: {
    name: 'ArrayAddress', parameters: ['int[,]'], result: 'int', body(writer, context) {
      const array = context.md.typeSpec({ kind: 'array', element: { kind: 'primitive', name: 'int' },
        rank: 2, sizes: [], lowerBounds: [] });
      const address = context.md.member(array, 'Address', methodSignature('int&', ['int', 'int'], false, context.resolve));
      writer.op('ldarg.0').op('ldc.i4.0').op('ldc.i4.0').group('call', address, [readonly]).op('ldind.i4').op('ret');
    },
  }, diagnostic: 'CILPC0006' },
];

export function prefixTypeFixture() {
  return managedFixture({ name: 'PrefixTypes', entry: null, methods: cases.map(value => value.method) });
}
