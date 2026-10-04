import {genericCallFixture} from './generic-call-fixture.js';

/** Shared independent CIL input for Node and real-browser compiled heap-bridge qualification. */
export function wasmHeapFixture() {
  return genericCallFixture([{name: 'Program', fields: [
    {name: 'Value', type: 'string'}, {name: 'Count', type: 'int', flags: 0x16}
  ], methods: [
    {name: 'Main', result: 'string', locals: ['Program', 'string[]'], body(writer, context) {
      writer.op('newobj', context.methods.get('Program..ctor')).op('stloc.0')
        .op('ldc.i4.1').op('newarr', context.resolve('System.String')).op('stloc.1')
        .op('ldloc.1').op('ldc.i4.0').op('ldstr', 0x70000000 + context.md.userString('rooted'))
        .op('stelem.ref').op('ldloc.0').op('ldloc.1').op('ldc.i4.0').op('ldelem.ref')
        .op('stfld', context.fields.get('Program.Value')).op('ldc.i4', 123)
        .op('stsfld', context.fields.get('Program.Count')).op('ldloc.0')
        .op('ldfld', context.fields.get('Program.Value')).op('ret');
    }},
    {name: '.ctor', static: false, flags: 0x1886, body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')}
  ]}]);
}
