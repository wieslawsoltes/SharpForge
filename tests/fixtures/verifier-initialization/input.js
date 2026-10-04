import { managedFixture } from '../../managed-fixtures.js';

const extension = 'Optional ECMA definite-assignment policy; ILVerify 10.0.5 requires InitLocals for local loads/addresses.';
const result = (name, accepted, body, options = {}) => ({ name, accepted, body, ...options });
const assigned = (name, body, options = {}) => result(name, true, body,
  { nativeAccepted: false, difference: extension, ...options });
function diamond(left, right) {
  return writer => {
    writer.op('ldarg.0').op('brtrue.s', 'right');
    if (left) writer.op('ldc.i4.1').op('stloc.0');
    writer.op('br.s', 'join').mark('right');
    if (right) writer.op('ldc.i4.2').op('stloc.0');
    writer.mark('join').op('ldloc.0').op('pop').op('ret');
  };
}
function switching(missing) {
  return writer => {
    writer.op('ldarg.0').op('switch', ['left', 'right']).op('ldc.i4.0').op('stloc.0').op('br.s', 'join');
    writer.mark('left').op('ldc.i4.1').op('stloc.0').op('br.s', 'join').mark('right');
    if (!missing) writer.op('ldc.i4.2').op('stloc.0');
    writer.mark('join').op('ldloc.0').op('pop').op('ret');
  };
}

export const initializationCases = [
  result('NoLocals', true, writer => writer.op('ret'), { locals: [] }),
  result('UnusedLocals', true, writer => writer.op('ret')),
  result('ReadUnset', false, writer => writer.op('ldloc.0').op('pop').op('ret')),
  result('AddressUnset', false, writer => writer.op('ldloca.s', 0).op('pop').op('ret')),
  assigned('StoredLoad', writer => writer.op('ldc.i4.1').op('stloc.0').op('ldloc.0').op('pop').op('ret')),
  assigned('StoredAddress', writer => writer.op('ldc.i4.1').op('stloc.0').op('ldloca.s', 0).op('pop').op('ret')),
  result('InitLocalsRead', true, writer => writer.op('ldloc.0').op('pop').op('ret'), { initLocals: true }),
  result('InitLocalsAddress', true, writer => writer.op('ldloca.s', 0).op('pop').op('ret'), { initLocals: true }),
  result('StoreWrongType', false, writer => writer.op('ldc.r8', 1).op('stloc.0').op('ret')),
  result('StoreUnderflow', false, writer => writer.op('stloc.0').op('ret')),
  assigned('DiamondBoth', diamond(true, true), { parameters: ['int'] }),
  result('DiamondLeftOnly', false, diamond(true, false), { parameters: ['int'] }),
  result('DiamondRightOnly', false, diamond(false, true), { parameters: ['int'] }),
  assigned('InitializedBeforeLoop', writer => {
    writer.op('ldc.i4.1').op('stloc.0').mark('loop').op('ldloc.0').op('pop').op('ldarg.0').op('brtrue.s', 'loop').op('ret');
  }, { parameters: ['int'] }),
  result('LoopMayNotExecute', false, writer => {
    writer.op('ldarg.0').op('brfalse.s', 'done').mark('loop').op('ldc.i4.1').op('stloc.0');
    writer.op('ldarg.0').op('brtrue.s', 'loop').mark('done').op('ldloc.0').op('pop').op('ret');
  }, { parameters: ['int'] }),
  result('UnreachableStore', false, writer => {
    writer.op('br.s', 'read').op('ldc.i4.1').op('stloc.0').mark('read').op('ldloc.0').op('pop').op('ret');
  }),
  assigned('SwitchAll', switching(false), { parameters: ['int'] }),
  result('SwitchMissing', false, switching(true), { parameters: ['int'] }),
  assigned('WordBoundaries', writer => {
    for (const index of [31, 32, 63, 64]) writer.op('ldc.i4.1').op('stloc', index);
    writer.op('br.s', 'read').mark('read');
    for (const index of [31, 32, 63, 64]) writer.op('ldloc', index).op('pop');
    writer.op('ret');
  }, { locals: Array(65).fill('int') }),
  result('SeparateWords', false, writer => writer.op('ldc.i4.1').op('stloc', 31).op('ldloc', 63).op('pop').op('ret'),
    { locals: Array(64).fill('int') }),
  assigned('ReferenceStore', writer => writer.op('ldnull').op('stloc.0').op('ldloc.0').op('pop').op('ret'), { locals: ['string'] }),
  assigned('ByrefStore', writer => writer.op('ldarg.0').op('stloc.0').op('ldloc.0').op('pop').op('ret'),
    { parameters: ['int&'], locals: ['int&'] }),
  result('ArgumentStoreDoesNotAssignLocal', false, writer => {
    writer.op('ldc.i4.1').op('starg.s', 0).op('ldloc.0').op('pop').op('ret');
  }, { parameters: ['int'] }),
  assigned('RepeatedStore', writer => {
    writer.op('ldc.i4.1').op('stloc.0').op('ldc.i4.2').op('stloc.0').op('ldloc.0').op('pop').op('ret');
  }),
];

export function initializationFixture(fixture) {
  return managedFixture({ name: fixture.name, entry: null, methods: [
    { maxStack: 8, locals: ['int'], initLocals: false, ...fixture },
  ] });
}
