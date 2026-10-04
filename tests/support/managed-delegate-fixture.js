import {genericCallFixture} from './generic-call-fixture.js';

const func = 'System.Func`1<int>';
const delegate = 'System.Delegate';

/** Independent managed CLI delegates: no source compiler delegate dispatcher. */
export function managedDelegateFixture(body) {
  const constructor = base => ({name: '.ctor', static: false, parameters: ['int'], flags: 0x1886,
    body(writer, context) {
      writer.op('ldarg.0');
      if (base) writer.op('ldarg.1').op('call', context.methods.get('Base..ctor'));
      else writer.op('call', context.member('System.Object', '.ctor', 'void', [], false))
        .op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Base.Value'));
      writer.op('ret');
    }});
  const targets = ['A', 'B', 'C'].map((name, index) => ({name, result: 'int', body(writer, context) {
    writer.op('ldsfld', context.fields.get('Program.Trace')).op('ldc.i4', 10).op('mul')
      .op('ldc.i4', index + 1).op('add').op('stsfld', context.fields.get('Program.Trace'))
      .op('ldc.i4', index + 1).op('ret');
  }}));
  return genericCallFixture([
    {name: 'Base', fields: [{name: 'Value', type: 'int'}], methods: [constructor(),
      {name: 'Get', static: false, flags: 0x1c6, result: 'int', body: writer => writer.op('ldc.i4.m1').op('ret')}]},
    {name: 'Derived', base: 'Base', methods: [constructor('Base'),
      {name: 'Get', static: false, flags: 0xc6, result: 'int', body(writer, context) {
        writer.op('call', context.member('System.GC', 'Collect', 'void'))
          .op('ldarg.0').op('ldfld', context.fields.get('Base.Value')).op('ldc.i4', 100).op('add').op('ret');
      }}]},
    {name: 'Program', fields: [{name: 'Trace', type: 'int', flags: 0x16}], methods: [
      {name: 'Main', result: 'int', locals: ['Base', func, func, func, func, delegate + '[]', delegate + '[]', 'int'],
        body(writer, context) {
          const owner = context.typeSpec(func);
          const call = (name, result, parameters = [], isStatic = false) =>
            context.member(name === 'Invoke' || name === '.ctor' ? owner : delegate, name, result, parameters, isStatic);
          const api = {
            construct: call('.ctor', 'void', ['object', 'nint']),
            invoke: call('Invoke', 'int'),
            combine: call('Combine', delegate, [delegate, delegate], true),
            remove: call('Remove', delegate, [delegate, delegate], true),
            equals: call('op_Equality', 'bool', [delegate, delegate], true),
            list: call('GetInvocationList', delegate + '[]'), owner,
            target(name) { writer.op('ldnull').op('ldftn', context.methods.get('Program.' + name)).op('newobj', api.construct); },
            bind() { writer.op('ldloc.0').op('dup').op('ldvirtftn', context.methods.get('Base.Get')).op('newobj', api.construct); },
            combined() { writer.op('call', api.combine).op('castclass', owner); },
            removed() { writer.op('call', api.remove).op('castclass', owner); },
            traceResult() {
              writer.op('stloc.s', 7).op('ldsfld', context.fields.get('Program.Trace')).op('ldc.i4', 10).op('mul')
                .op('ldloc.s', 7).op('add').op('ret');
            }
          };
          body(writer, context, api);
        }}, ...targets]
    }
  ]);
}
