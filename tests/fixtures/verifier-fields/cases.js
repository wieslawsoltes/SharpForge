const owner = 'class Fixture.Owner';
const derived = 'class Fixture.Derived';
const other = 'class Fixture.Other';
const value = 'valuetype Fixture.Value';
const field = (writer, context, opcode, name = 'Owner.Number') => writer.op(opcode, context.members[name]);

function load(name, receiver, status = 'verified', options = {}) {
  return { name, parameters: [receiver], status, ...options,
    body(writer, context) { writer.op('ldarg.0'); field(writer, context, 'ldfld', options.field); writer.op('pop').op('ret'); } };
}
function store(name, receiver, stored = 'int', status = 'verified', options = {}) {
  return { name, parameters: [receiver, stored], status, ...options,
    body(writer, context) { writer.op('ldarg.0').op('ldarg.1'); field(writer, context, 'stfld', options.field); writer.op('ret'); } };
}

export const fieldCases = [
  load('LoadOwner', owner), load('LoadDerived', derived), load('LoadWrongReceiver', other, 'rejected'),
  load('LoadNumericReceiver', 'int', 'rejected'), load('LoadReferenceAddress', owner + '&', 'rejected'),
  load('LoadValueAddress', value + '&', 'verified', { field: 'Value.Number' }),
  load('LoadValueCopy', value, 'verified', { field: 'Value.Number' }),
  load('LoadStaticThroughInstance', owner, 'verified', { field: 'Owner.Shared' }),
  load('LoadPrivateOutside', owner, 'rejected', { field: 'Owner.Private' }),
  load('LoadPrivateInside', owner, 'verified', { owner: 'Owner', field: 'Owner.Private' }),
  load('LoadProtectedDerived', derived, 'verified', { owner: 'Derived', field: 'Owner.Protected' }),
  load('LoadProtectedBaseReceiver', owner, 'rejected', { owner: 'Derived', field: 'Owner.Protected' }),
  store('StoreOwner', owner), store('StoreDerived', derived), store('StoreWrongReceiver', other, 'int', 'rejected'),
  store('StoreWrongValue', owner, 'double', 'rejected'),
  store('StoreReferenceDerived', owner, derived, 'verified', { field: 'Owner.Reference' }),
  store('StoreReferenceUnrelated', owner, other, 'rejected', { field: 'Owner.Reference' }),
  store('StoreValueAddress', value + '&', 'int', 'verified', { field: 'Value.Number' }),
  store('StoreValueCopyUnknown', value, 'int', 'unknown', { field: 'Value.Number', nativeAccepted: true }),
  store('StoreInitOnlyOutside', owner, 'int', 'rejected', { field: 'Owner.Readonly' }),
  { name: 'StoreInitOnlyNormalInstance', instance: true, owner: 'Owner', parameters: ['int'], status: 'rejected', body(writer, context) {
    writer.op('ldarg.0').op('ldarg.1'); field(writer, context, 'stfld', 'Owner.Readonly'); writer.op('ret');
  } },
  store('StoreStaticThroughInstance', owner, 'int', 'verified', { field: 'Owner.Shared' }),
  { name: 'NormalThisLoad', instance: true, owner: 'Owner', status: 'verified', body(writer, context) {
    writer.op('ldarg.0'); field(writer, context, 'ldfld'); writer.op('pop').op('ret');
  } },
  { name: 'ValueThisLoad', instance: true, owner: 'Value', status: 'verified', body(writer, context) {
    writer.op('ldarg.0'); field(writer, context, 'ldfld', 'Value.Number'); writer.op('pop').op('ret');
  } },
  { name: 'NullReceiver', status: 'verified', body(writer, context) {
    writer.op('ldnull'); field(writer, context, 'ldfld'); writer.op('pop').op('ret');
  } },
  { name: 'LoadStatic', status: 'verified', body(writer, context) {
    field(writer, context, 'ldsfld', 'Owner.Shared'); writer.op('pop').op('ret');
  } },
  { name: 'LoadStaticMismatch', status: 'rejected', body(writer, context) {
    field(writer, context, 'ldsfld'); writer.op('pop').op('ret');
  } },
  { name: 'StoreStatic', status: 'verified', body(writer, context) {
    writer.op('ldc.i4.1'); field(writer, context, 'stsfld', 'Owner.Shared'); writer.op('ret');
  } },
  { name: 'StoreStaticWrongValue', status: 'rejected', body(writer, context) {
    writer.op('ldc.r8', 1); field(writer, context, 'stsfld', 'Owner.Shared'); writer.op('ret');
  } },
  { name: 'StoreStaticInitOnlyOutside', status: 'rejected', body(writer, context) {
    writer.op('ldc.i4.1'); field(writer, context, 'stsfld', 'Owner.SharedReadonly'); writer.op('ret');
  } },
  { name: 'StoreStaticInitOnlyCctor', methodName: '.cctor', flags: 0x1891, owner: 'Owner', status: 'verified', body(writer, context) {
    writer.op('ldc.i4.1'); field(writer, context, 'stsfld', 'Owner.SharedReadonly'); writer.op('ret');
  } },
  { name: 'StoreStaticInitOnlyWrongCctor', methodName: '.cctor', flags: 0x1891, status: 'rejected', body(writer, context) {
    writer.op('ldc.i4.1'); field(writer, context, 'stsfld', 'Owner.SharedReadonly'); writer.op('ret');
  } },
  { name: 'AddressField', parameters: [owner], status: 'verified', body(writer, context) {
    writer.op('ldarg.0'); field(writer, context, 'ldflda'); writer.op('pop').op('ret');
  } },
  { name: 'AddressStatic', status: 'verified', body(writer, context) {
    field(writer, context, 'ldsflda', 'Owner.Shared'); writer.op('pop').op('ret');
  } },
  { name: 'AddressInitOnly', parameters: [owner], status: 'rejected', nativeAccepted: true,
    difference: 'ECMA III.4.11 prohibits init-only ldflda; ILVerify 10.0.5 leaves this check unimplemented.', body(writer, context) {
      writer.op('ldarg.0'); field(writer, context, 'ldflda', 'Owner.Readonly'); writer.op('pop').op('ret');
    } },
  { name: 'ReferenceReturn', parameters: [derived], result: owner, status: 'verified',
    body: writer => writer.op('ldarg.0').op('ret') },
  { name: 'WrongReferenceReturn', parameters: [other], result: owner, status: 'rejected',
    body: writer => writer.op('ldarg.0').op('ret') },
  { name: 'ReferenceLocal', parameters: [derived], locals: [owner], status: 'verified',
    body: writer => writer.op('ldarg.0').op('stloc.0').op('ldloc.0').op('pop').op('ret') },
  { name: 'ReferenceJoin', parameters: [owner, derived], status: 'verified', body(writer, context) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldarg.0').op('br.s', 'join');
    writer.mark('right').op('ldarg.1').mark('join'); field(writer, context, 'ldfld'); writer.op('pop').op('ret');
  } },
];
