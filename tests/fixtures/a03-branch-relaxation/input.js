import { CilWriter } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export function layoutFixture() {
  const body = action => target => {
    const writer = new CilWriter(undefined, { compact: true });
    action(writer);
    target.bytes(writer.finishWithLayout().code);
  };
  return managedFixture({ name: 'BranchLayout', methods: [
    { name: 'Main', result: 'int', locals: ['int'], body: body(writer => writer.integer(0).local('stloc', 0)
      .op('br.s', 'test').mark('body').integer(42).local('stloc', 0).zero(300).op('br.s', 'done')
      .mark('test').local('ldloc', 0).op('brfalse.s', 'body').mark('done').local('ldloc', 0).op('ret')) },
    ...[127, 128].map(padding => ({ name: `Forward${padding}`, result: 'int',
      body: body(writer => writer.op('br', 'done').zero(padding).mark('done').integer(padding - 120).op('ret')) })),
    { name: 'Switch', result: 'int', body: body(writer => writer.integer(1).op('switch', ['bad', 'good'])
      .mark('bad').integer(-1).op('ret').op('br', 'good').mark('good').integer(9).op('ret')) },
  ] });
}
