import {managedFixture} from '../managed-fixtures.js';
import {genericCallFixture} from '../support/generic-call-fixture.js';

export function callbackAssembly({value = 'managed', throwing = false, loop = false, invalid = false, trace = false, unverified = false} = {}) {
  return managedFixture({methods: [
    {name: 'Main', result: 'string', locals: ['string'], body(writer, context) {
      writer.op('ldstr', 0x70000000 + context.md.userString('caller')).op('stloc.0')
        .op('newobj', context.methods['.ctor'])
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }},
    {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
      writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
    }},
    {name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
      if (unverified) { writer.op('pop').op('ret'); return; }
      if (loop) { writer.mark('loop').op('br', 'loop'); return; }
      if (throwing) { writer.op('ldnull').op('throw'); return; }
      if (trace) writer.op('ldstr', 0x70000000 + context.md.userString('callback'))
        .op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
      if (invalid) writer.op('ldc.i4.1');
      else if (value === null) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(value));
      writer.op('ret');
    }},
    {name: 'StoreAndCollect', parameters: ['string&'], result: 'string', body(writer, context) {
      writer.op('ldarg.0').op('ldstr', 0x70000000 + context.md.userString('replacement')).op('stind.ref')
        .op('call', context.member('System.GC', 'Collect', 'void'))
        .op('ldarg.0').op('ldind.ref').op('ret');
    }}
  ]});
}

/** An unreachable ordinary method is admitted only when the host explicitly requests its callback entry. */
export function unverifiedCallbackAssembly() {
  return managedFixture({methods: [
    {name: 'Main', body: writer => writer.op('ret')},
    {name: 'UnverifiedCallback', body: writer => writer.op('pop').op('ret')}
  ]});
}

function constructor(base) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', target).op('ret');
  }};
}

function textMethod(value, flags) {
  return {name: 'ToString', static: false, flags, result: 'string', body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString(value)).op('ret');
  }};
}

/** Genuine MethodDef slot flags; no compiler or SharpForge debug profile supplies dispatch metadata. */
export function objectStringHierarchy({root = true, middle = null, leaf = true} = {}) {
  return genericCallFixture([
    {name: 'Root', methods: [constructor(), ...(root ? [textMethod('root override', 0xc6)] : [])]},
    {name: 'Middle', base: 'Root', methods: [constructor('Root'),
      ...(middle ? [textMethod('middle method', middle === 'newslot' ? 0x1c6 : middle === 'hidden' ? 0x86 : 0xc6)] : [])]},
    {name: 'Leaf', base: 'Middle', methods: [constructor('Middle'), ...(leaf ? [textMethod('leaf override', 0xc6)] : [])]},
    {name: 'Program', methods: [{name: 'Main', result: 'string', body(writer, context) {
      writer.op('newobj', context.methods.get('Leaf..ctor'))
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }}]}
  ]);
}

/** A real boxed sequential struct invokes its override on the existing box interior. */
export function boxedStringOverride() {
  return genericCallFixture([
    {name: 'Value', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Count', type: 'int'}], methods: [
      {name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
        const field = context.fields.get('Value.Count');
        writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldc.i4.1').op('add').op('stfld', field)
          .op('call', context.member('System.GC', 'Collect', 'void'))
          .op('ldstr', 0x70000000 + context.md.userString('boxed override')).op('ret');
      }}
    ]},
    {name: 'Program', methods: [{name: 'Main', result: 'string', locals: ['Value', 'object'], body(writer, context) {
      writer.op('ldloc.0').op('box', context.resolve('Value')).op('stloc.1').op('ldloc.1')
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }}]}
  ]);
}

/** The callback enters a real cctor; its existing exception can outlive failure to allocate a wrapper. */
export function initializingCallbackAssembly() {
  return genericCallFixture([
    {name: 'Value', methods: [{name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
      writer.op('ldsfld', context.fields.get('Failer.State')).op('pop')
        .op('ldstr', 0x70000000 + context.md.userString('unreachable')).op('ret');
    }}]},
    {name: 'Failer', fields: [{name: 'State', type: 'int', flags: 0x16}], methods: [
      {name: '.cctor', flags: 0x1891, locals: ['System.Exception'], body(writer, context) {
        writer.op('ldstr', 0x70000000 + context.md.userString('initializer cause'))
          .op('newobj', context.member('System.Exception', '.ctor', 'void', ['string'], false)).op('stloc.0')
          .op('ldstr', 0x70000000 + context.md.userString('initializer'))
          .op('call', context.member('System.Console', 'WriteLine', 'void', ['string']))
          .op('ldloc.0').op('throw');
      }}
    ]},
    {name: 'Program', methods: [{name: 'Main', body: writer => writer.op('ret')}]}
  ]);
}
