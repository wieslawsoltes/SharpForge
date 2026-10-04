import { codedIndex, methodSignature, fieldSignature } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export function inheritedMemberFixture(decorate) {
  const tokens = { base: 0x02000002, middle: 0x02000003, child: 0x02000004 };
  const bytes = managedFixture({ name: 'InheritedMemberReferences', entry: null,
    fields: [{ name: 'Number' }, { name: 'Shadow' }, { name: 'Shadow' }, { name: 'Shadow', type: 'string' }],
    methods: [
      { name: 'Pick', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ret') },
      { name: 'Pick', result: 'string', parameters: ['string'], body: writer => writer.op('ldarg.0').op('ret') },
      { name: 'Secret', flags: 0x91, body: writer => writer.op('ret') },
      { name: '.ctor', static: false, flags: 0x1886, body: (writer, context) => writer.op('ldarg.0')
        .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret') },
      { name: 'Pick', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ret') },
      { name: '.ctor', static: false, flags: 0x1886,
        body: writer => writer.op('ldarg.0').op('call', 0x06000004).op('ret') },
    ],
    decorate(context) {
      const { md } = context;
      md.rows[2][1][1] = md.string('Base');
      md.add(2, [0x100001, md.string('Middle'), md.string('Fixture'), codedIndex('TypeDefOrRef', tokens.base), 3, 5]);
      md.add(2, [0x100001, md.string('Child'), md.string('Fixture'), codedIndex('TypeDefOrRef', tokens.middle), 5, 7]);
      for (const [name, owner, member, signature] of [
        ['baseField', tokens.base, 'Number', fieldSignature('int')],
        ['inheritedField', tokens.child, 'Number', fieldSignature('int')],
        ['hiddenField', tokens.child, 'Shadow', fieldSignature('int')],
        ['stringField', tokens.child, 'Shadow', fieldSignature('string')],
        ['hiddenMethod', tokens.child, 'Pick', methodSignature('int', ['int'], true)],
        ['inheritedOverload', tokens.child, 'Pick', methodSignature('string', ['string'], true)],
        ['privateMethod', tokens.child, 'Secret', methodSignature('void', [], true)],
        ['directConstructor', tokens.middle, '.ctor', methodSignature('void', [], false)],
        ['inheritedConstructor', tokens.child, '.ctor', methodSignature('void', [], false)],
        ['missing', tokens.child, 'Missing', methodSignature('void', [], true)],
      ]) tokens[name] = md.member(owner, member, signature);
      decorate?.(context, tokens);
    },
  });
  return { bytes, tokens };
}

export const inheritedKnownCases = Object.freeze({
  baseField: 0x04000001, hiddenMethod: 0x06000005, inheritedOverload: 0x06000002,
  privateMethod: 0x06000003, directConstructor: 0x06000006,
});

export const inheritedUnknownCases = Object.freeze({
  inheritedField: 'ArgumentOutOfRangeException', hiddenField: 'ArgumentOutOfRangeException',
  stringField: 'ArgumentOutOfRangeException', inheritedConstructor: 'MissingMethodException', missing: 'MissingMethodException',
});
