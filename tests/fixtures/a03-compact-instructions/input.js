import { CilWriter } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export const integerCases = [-2147483648, -129, -128, -1, 0, 8, 9, 127, 128, 2147483647, 2147483648, 4294967295];

export function compactFixture(compact = true) {
  const body = action => (target, context) => {
    const writer = new CilWriter(undefined, { compact });
    action(writer, context);
    target.bytes(writer.finish());
  };
  return managedFixture({ name: compact ? 'CompactInstructions' : 'WideInstructions', methods: [
    { name: 'Main', result: 'int', locals: Array(257).fill('int'), body: body((writer, context) => {
      for (let value = 1; value <= 5; value++) writer.integer(value);
      writer.op('call', context.methods.Echo).local('stloc', 256).local('ldloc', 256).op('ret');
    }) },
    { name: 'Echo', parameters: Array(5).fill('int'), result: 'int', body: body(writer => writer.local('ldarg', 4).op('ret')) },
    ...integerCases.map((value, index) => ({ name: `Literal${index}`, result: 'int',
      body: body(writer => writer.integer(value).op('ret')) })),
  ] });
}
