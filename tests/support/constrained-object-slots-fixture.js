import {genericCallFixture} from './generic-call-fixture.js';

const results = {ToString: 'string', Equals: 'bool', GetHashCode: 'int'};

/** Independent CIL: identical Object slots exercise concrete and shared generic receiver paths. */
export function objectSlotFixture({operation = 'Equals', kind = 'struct', override = false, generic = false,
  closedGeneric = false, same = true, newSlot = false, throwing = false, parameterFlags = 0} = {}) {
  const value = kind === 'struct', primitive = kind === 'int';
  const name = closedGeneric ? 'Receiver`1' : 'Receiver';
  const closed = closedGeneric ? name + '<int>' : name;
  const storage = primitive ? 'int' : value ? 'valuetype ' + closed : closed;
  const constraint = context => primitive ? context.resolve('System.Int32')
    : closedGeneric ? context.typeSpec((value ? 'valuetype ' : '') + closed) : context.resolve(name);
  const field = context => closedGeneric ? context.field(context.typeSpec((value ? 'valuetype ' : '') + closed), 'X', '!0')
    : context.fields.get(name + '.X');
  const member = context => context.member('System.Object', operation, results[operation], operation === 'Equals' ? ['object'] : [], false);
  const methods = [];
  if (!value && !primitive) methods.push({name: '.ctor', static: false, body: writer => writer.op('ret')});
  if (override || newSlot) methods.push({name: operation, static: false, flags: newSlot ? 0x1c6 : 0xc6,
    result: results[operation], parameters: operation === 'Equals' ? ['object'] : [], body(writer, context) {
      if (throwing) { writer.op('ldnull').op('throw'); return; }
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      if (!closedGeneric) writer.op('ldarg.0').op('dup').op('ldfld', field(context)).op('ldc.i4.1').op('add').op('stfld', field(context));
      if (operation === 'ToString') writer.op('ldstr', 0x70000000 + context.md.userString('custom'));
      else writer.op('ldc.i4', operation === 'Equals' ? 1 : 37);
      writer.op('ret');
    }});
  const apply = {name: 'Apply', genericParameters: [{flags: parameterFlags}],
    parameters: operation === 'Equals' ? ['!!0&', 'object'] : ['!!0&'], result: results[operation], body(writer, context) {
      writer.op('ldarg.0');
      if (operation === 'Equals') writer.op('ldarg.1');
      writer.op('constrained.', context.typeSpec('!!0')).op('callvirt', member(context)).op('ret');
    }};
  return genericCallFixture([
    ...(primitive ? [] : [{name, base: value ? 'System.ValueType' : 'System.Object', flags: value ? 0x100109 : 0x100001,
      ...(closedGeneric ? {genericParameters: [{}]} : {}), fields: [{name: 'X', type: closedGeneric ? '!0' : 'int'}], methods}]),
    {name: 'Program', methods: [...(generic ? [apply] : []), {name: 'Main', result: results[operation], locals: [storage, storage],
      body(writer, context) {
        if (primitive) writer.op('ldc.i4', 23).op('stloc.0');
        else {
          if (!value) {
            const constructor = closedGeneric ? context.member(context.typeSpec(closed), '.ctor', 'void', [], false)
              : context.methods.get(name + '..ctor');
            writer.op('newobj', constructor).op('stloc.0');
          }
          writer.op(value ? 'ldloca.s' : 'ldloc.s', 0).op('ldc.i4', 23).op('stfld', field(context));
        }
        writer.op('ldloc.0').op('stloc.1');
        if (!same && (primitive || value)) {
          if (primitive) writer.op('ldc.i4', 24).op('stloc.1');
          else writer.op('ldloca.s', 1).op('ldc.i4', 24).op('stfld', field(context));
        }
        writer.op('ldloca.s', 0);
        if (operation === 'Equals') {
          if (!same && !primitive && !value) writer.op('ldnull');
          else writer.op('ldloc.1');
          if (primitive || value) writer.op('box', constraint(context));
        }
        if (generic) writer.op('call', context.methodSpec(context.methods.get('Program.Apply'), [storage]));
        else writer.op('constrained.', constraint(context)).op('callvirt', member(context));
        writer.op('ret');
      }}]}
  ]);
}
