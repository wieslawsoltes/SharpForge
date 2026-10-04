import { managedFixture } from '../../managed-fixtures.js';

const tail = { name: 'tail.' };
const invoke = (writer, context, prefixes = [tail]) => writer.group('call', context.methods.Target, prefixes);

export const cases = [
  { method: { name: 'Valid', result: 'int', body: (writer, context) => invoke(writer, context).op('ret') }, diagnostic: null },
  { method: { name: 'BadTarget', body: writer => writer.group('nop', undefined, [tail]).op('ret') }, diagnostic: 'CILPT0002' },
  { method: { name: 'MissingRet', result: 'int', body: invoke }, diagnostic: 'CILPT0003' },
  { method: { name: 'Intervening', result: 'int', body: (writer, context) => invoke(writer, context).op('nop').op('ret') },
    diagnostic: 'CILPT0003' },
  { method: { name: 'Repeated', result: 'int', body: (writer, context) => invoke(writer, context, [tail, tail]).op('ret') },
    diagnostic: 'CILPT0001' },
  { method: {
    name: 'Protected', result: 'int',
    body: (writer, context) => invoke(writer, context).op('ret').op('pop').op('ldc.i4.0').op('ret'),
    handlers: (_labels, context) => [{ start: 0, end: 8, target: 8, handlerEnd: 11, catchType: context.resolve('Exception') }],
  }, diagnostic: 'CILCF0006' },
];

export function prefixTailFixture() {
  return managedFixture({ name: 'PrefixTail', entry: 1, methods: [
    { name: 'Target', result: 'int', body: writer => writer.op('ldc.i4.s', 42).op('ret') },
    ...cases.map(value => value.method),
  ] });
}
