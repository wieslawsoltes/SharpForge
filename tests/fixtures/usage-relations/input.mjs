import { methodSignature, fieldSignature } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export function usageFixture() {
  const tokens = {};
  const bytes = managedFixture({ name: 'UsageRelations', entry: null,
    fields: [{ name: 'Value', type: 'int', static: false }, { name: 'Shared', type: 'int' }],
    methods: [
      { name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
        writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
      } },
      { name: 'Read', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ret') },
      { name: 'Run', body(writer, { md, methods, fields, type, resolve }) {
        tokens.type = type; tokens.run = methods.Run; tokens.read = methods.Read; tokens.constructor = methods['.ctor'];
        tokens.value = fields.Value; tokens.shared = fields.Shared;
        tokens.constructorRef = md.member(type, '.ctor', methodSignature('void', [], false, resolve));
        tokens.readRef = md.member(type, 'Read', methodSignature('int', ['int'], true, resolve));
        tokens.valueRef = md.member(type, 'Value', fieldSignature('int', resolve));
        tokens.sharedRef = md.member(type, 'Shared', fieldSignature('int', resolve));
        writer.op('newobj', tokens.constructorRef).op('dup').op('ldc.i4.1').op('stfld', tokens.valueRef)
          .op('ldfld', tokens.valueRef).op('call', tokens.readRef).op('stsfld', tokens.sharedRef)
          .op('ldc.i4.2').op('call', methods.Read).op('pop').op('ldsfld', tokens.sharedRef).op('pop')
          .op('ldtoken', type).op('pop').op('ldc.i4.1').op('newarr', type).op('pop')
          .op('ldstr', 0x70000000 + md.userString('literal')).op('pop').op('ret');
      } },
      { name: 'External', body(writer, context) {
        tokens.external = context.methods.External;
        tokens.externalRef = context.member('System.Console', 'WriteLine', 'void');
        writer.op('call', tokens.externalRef).op('ret');
      } },
    ],
  });
  return { bytes, tokens };
}
