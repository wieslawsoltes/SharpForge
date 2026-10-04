import { methodSignature, fieldSignature } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export function memberFixture(decorate) {
  const tokens = {};
  const bytes = managedFixture({ name: 'VerifierMembers', entry: null,
    fields: [{ name: 'Number', type: 'int' }, { name: 'Text', type: 'string' }],
    methods: [
      { name: 'Pick', parameters: ['int'], result: 'int', body: writer => writer.op('ldarg.0').op('ret') },
      { name: 'Pick', parameters: ['string'], result: 'string', body: writer => writer.op('ldarg.0').op('ret') },
      { name: 'Instance', static: false, result: 'int', body: writer => writer.op('ldc.i4.7').op('ret') },
      { name: 'Hidden', flags: 0x91, body: writer => writer.op('ret') },
      { name: 'Self', parameters: ['Fixture.Program'], body: writer => writer.op('ret') },
    ],
    decorate(context) {
      const { md, type, resolve } = context;
      tokens.owner = type;
      tokens.field = md.member(type, 'Number', fieldSignature('int', resolve));
      tokens.intMethod = md.member(type, 'Pick', methodSignature('int', ['int'], true, resolve));
      tokens.stringMethod = md.member(type, 'Pick', methodSignature('string', ['string'], true, resolve));
      tokens.instance = md.member(type, 'Instance', methodSignature('int', [], false, resolve));
      tokens.privateMethod = md.member(type, 'Hidden', methodSignature('void', [], true, resolve));
      tokens.localType = md.member(type, 'Self', methodSignature('void', ['Fixture.Program'], true, resolve));
      tokens.missing = md.member(type, 'Pick', methodSignature('int', ['long'], true, resolve));
      const external = md.typeRef('Fixture.Program', 'Another.Assembly');
      tokens.external = md.member(external, 'Pick', methodSignature('int', ['int'], true, resolve));
      tokens.unresolvedSignature = md.member(type, 'Self', methodSignature('void', ['Foreign.Type'], true, resolve));
      decorate?.(context, tokens);
    },
  });
  return { bytes, tokens };
}
