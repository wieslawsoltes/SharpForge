// Independently assembled shape of the Release Roslyn async lowering. The native
// fixture beside Program.cs is compiled by Roslyn separately during qualification.
import {
  Writer,
  codedIndex
} from '@sharpforge/cil';
import {
  controlFixture
} from './control-fixture.js';
const C = 'System.Runtime.CompilerServices.',
  TASK = 'System.Threading.Tasks.Task',
  BUILDER = C + 'AsyncTaskMethodBuilder`1<int>',
  AWAITER = C + 'TaskAwaiter',
  RESULT_AWAITER = C + 'TaskAwaiter`1<int>';
const primitive = {
  void: 1,
  bool: 2,
  int: 8,
  object: 0x1c
};

function type(writer, name, c) {
  if (name.endsWith('&')) {
    writer.u8(0x10);
    return type(writer, name.slice(0, -1), c);
  }
  if (name in primitive) return writer.u8(primitive[name]);
  const value = name === 'Machine' || name.startsWith(C + 'Async') || name.startsWith(C + 'TaskAwaiter');
  return writer.u8(value ? 0x11 : 0x12).compressed(codedIndex('TypeDefOrRef', c.resolve(name)));
}
const signature = (result, parameters, isStatic, c, genericArity = 0) => {
  const w = new Writer().u8((isStatic ? 0 : 0x20) | (genericArity ? 0x10 : 0));
  if (genericArity) w.compressed(genericArity);
  w.compressed(parameters.length);
  type(w, result, c);
  for (const parameter of parameters) type(w, parameter, c);
  return w.finish();
};
const member = (c, owner, name, result, parameters = [], isStatic = false) => c.md.member(c.resolve(owner), name, signature(result, parameters,
  isStatic, c));
const genericMember = (c, name, arity) => c.md.member(c.resolve(BUILDER), name, new Writer().u8(0x30).compressed(arity).compressed(arity).u8(1).bytes(
  Array.from({
    length: arity
  }, (_, index) => [0x10, 0x1e, index]).flat()).finish());
const genericArguments = (c, names) => names.map(name => Array.from(type(new Writer(), name, c).finish()));
const field = (c, name) => c.fields.get('Machine.' + name);
const callAwait = (w, c, state, done, resume) => {
  w.op('ldc.i4.5').op('call', member(c, TASK, 'Delay', TASK, ['int'], true)).op('callvirt', member(c, TASK, 'GetAwaiter', AWAITER)).op('stloc.0')
    .op('ldloca.s', 0).op('call', member(c, AWAITER, 'get_IsCompleted', 'bool')).op('brtrue', done)
    .op('ldarg.0').op('ldc.i4', state).op('stfld', field(c, 'State')).op('ldarg.0').op('ldloc.0').op('stfld', field(c, 'Awaiter'))
    .op('ldarg.0').op('ldflda', field(c, 'Builder')).op('ldloca.s', 0).op('ldarg.0')
    .op('call', c.methodSpec(genericMember(c, 'AwaitUnsafeOnCompleted', 2), genericArguments(c, [AWAITER, 'Machine']))).op('leave', 'exit')
    .label(resume).op('ldarg.0').op('ldfld', field(c, 'Awaiter')).op('stloc.0').op('ldarg.0').op('ldflda', field(c, 'Awaiter')).op('initobj', c
      .resolve(AWAITER))
    .op('ldarg.0').op('ldc.i4.m1').op('stfld', field(c, 'State')).label(done).op('ldloca.s', 0).op('call', member(c, AWAITER, 'GetResult', 'void'));
};
export function asyncFixture() {
  return controlFixture([{
      name: 'Program',
      fields: [{
        name: 'Cleanup'
      }],
      methods: [{
        name: 'Main',
        localBytes: c => {
          const w = new Writer().u8(7).u8(2);
          type(w, 'Machine', c);
          type(w, RESULT_AWAITER, c);
          return w.finish();
        },
        body: (w, c) => {
          w.op('ldloca.s', 0).op('initobj', c.resolve('Machine')).op('ldloca.s', 0).op('ldc.i4.m1').op('stfld', field(c, 'State'))
            .op('ldloca.s', 0).op('call', member(c, BUILDER, 'Create', BUILDER, [], true)).op('stfld', field(c, 'Builder'))
            .op('ldloca.s', 0).op('ldflda', field(c, 'Builder')).op('ldloca.s', 0).op('call', c.methodSpec(genericMember(c, 'Start', 1),
              genericArguments(c, ['Machine'])))
            .op('ldloca.s', 0).op('ldflda', field(c, 'Builder')).op('call', member(c, BUILDER, 'get_Task', TASK + '`1<int>'))
            .op('callvirt', member(c, TASK + '`1<int>', 'GetAwaiter', RESULT_AWAITER)).op('stloc.1').op('ldloca.s', 1).op('call', member(c,
              RESULT_AWAITER, 'GetResult', 'int'))
            .op('call', c.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
        }
      }]
    },
    {
      name: 'Machine',
      base: 'System.ValueType',
      flags: 0x100109,
      interfaces: [C + 'IAsyncStateMachine'],
      fields: [{
        name: 'State',
        type: 'int',
        flags: 6
      }, {
        name: 'Builder',
        type: BUILDER,
        flags: 6
      }, {
        name: 'Awaiter',
        type: AWAITER,
        flags: 6
      }, {
        name: 'Count',
        type: 'int',
        flags: 6
      }],
      methods: [{
        name: 'MoveNext',
        static: false,
        flags: 0x1e1,
        localBytes: c => {
          const w = new Writer().u8(7).u8(3);
          type(w, AWAITER, c);
          type(w, 'object', c);
          type(w, 'int', c);
          return w.finish();
        },
        body: (w, c) => {
          w.label('outer').label('try').op('ldarg.0').op('ldfld', field(c, 'State')).op('ldc.i4.0').op('beq', 'resume0')
            .op('ldarg.0').op('ldfld', field(c, 'State')).op('ldc.i4.1').op('beq', 'resume1');
          callAwait(w, c, 0, 'firstDone', 'resume0');
          w.op('ldarg.0').op('ldc.i4', 20).op('stfld', field(c, 'Count'));
          callAwait(w, c, 1, 'secondDone', 'resume1');
          w.op('ldarg.0').op('ldfld', field(c, 'Count')).op('ldc.i4', 22).op('add').op('stloc.2').op('leave', 'success')
            .label('tryEnd').label('finally').op('ldarg.0').op('ldfld', field(c, 'State')).op('ldc.i4.0').op('bge', 'endFinally')
            .op('ldsfld', c.fields.get('Program.Cleanup')).op('ldc.i4.1').op('add').op('stsfld', c.fields.get('Program.Cleanup')).label(
              'endFinally').op('endfinally').label('finallyEnd').label('outerEnd')
            .label('catch').op('stloc.1').op('ldarg.0').op('ldc.i4', -2).op('stfld', field(c, 'State')).op('ldarg.0').op('ldflda', field(c,
              'Builder')).op('ldloc.1').op('call', member(c, BUILDER, 'SetException', 'void', ['System.Exception'])).op('leave', 'exit')
            .label('catchEnd').label('success').op('ldarg.0').op('ldc.i4', -2).op('stfld', field(c, 'State')).op('ldarg.0').op('ldflda',
              field(c, 'Builder')).op('ldloc.2').op('call', member(c, BUILDER, 'SetResult', 'void', ['int'])).label('exit').op('ret');
        },
        handlers: (l, c) => [{
            flags: 2,
            start: l.get('try'),
            end: l.get('tryEnd'),
            target: l.get('finally'),
            handlerEnd: l.get('finallyEnd')
          },
          {
            flags: 0,
            start: l.get('outer'),
            end: l.get('outerEnd'),
            target: l.get('catch'),
            handlerEnd: l.get('catchEnd'),
            catchType: c.resolve('System.Exception')
          }
        ]
      }, {
        name: 'SetStateMachine',
        static: false,
        flags: 0x1e1,
        parameters: [C + 'IAsyncStateMachine'],
        body: w => w.op('ret')
      }]
    }
  ], {
    decorate: c => {
      for (const [name, fieldType] of [
          ['Builder', BUILDER],
          ['Awaiter', AWAITER]
        ]) c.md.rows[4][(field(c, name) & 0xffffff) - 1][2] = c.md.blob(type(new Writer().u8(6), fieldType, c).finish());
      c.md.add(25, [c.types.get('Machine') & 0xffffff, codedIndex('MethodDefOrRef', c.methods.get('Machine.MoveNext')), codedIndex(
        'MethodDefOrRef', member(c, C + 'IAsyncStateMachine', 'MoveNext', 'void'))]);
      c.md.add(25, [c.types.get('Machine') & 0xffffff, codedIndex('MethodDefOrRef', c.methods.get('Machine.SetStateMachine')),
        codedIndex('MethodDefOrRef', member(c, C + 'IAsyncStateMachine', 'SetStateMachine', 'void', [C + 'IAsyncStateMachine']))]);
    }
  });
}
export {
  BUILDER,
  AWAITER,
  RESULT_AWAITER,
  TASK,
  signature as asyncSignature,
  type as asyncSignatureType
};
