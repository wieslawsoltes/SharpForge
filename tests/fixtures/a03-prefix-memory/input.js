import { managedFixture } from '../../managed-fixtures.js';

const volatile = { name: 'volatile.' };
const unaligned = { name: 'unaligned.', operand: 1 };
const load = (name, prefixes) => ({
  name, result: 'int', parameters: ['int'],
  body: writer => writer.op('ldarga.s', 0).group('ldind.i4', undefined, prefixes).op('ret'),
});
const badTarget = (name, prefix) => ({
  name, body: writer => writer.group('nop', undefined, [prefix]).op('ret'),
});

export const cases = [
  { method: load('Volatile', [volatile]), diagnostic: null },
  { method: load('Unaligned', [unaligned]), diagnostic: null },
  { method: load('VolatileUnaligned', [volatile, unaligned]), diagnostic: null },
  { method: load('UnalignedVolatile', [unaligned, volatile]), diagnostic: null },
  { method: badTarget('BadVolatile', volatile), diagnostic: 'CILPM0002' },
  { method: badTarget('BadUnaligned', unaligned), diagnostic: 'CILPM0002' },
  { method: load('RepeatedVolatile', [volatile, volatile]), diagnostic: 'CILPM0001' },
  { method: {
    name: 'NoArray', result: 'int', parameters: ['int[]'],
    body: writer => writer.op('ldarg.0').op('ldc.i4.0').group('ldelem.i4', undefined, [{ name: 'no.', operand: 6 }]).op('ret'),
  }, diagnostic: 'CILPM0004' },
];

export function prefixMemoryFixture() {
  return managedFixture({ name: 'PrefixMemory', entry: null, methods: cases.map(value => value.method) });
}
