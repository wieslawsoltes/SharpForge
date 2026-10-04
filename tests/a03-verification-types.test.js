import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VerificationKind as Kind, verificationType as type, mergeVerificationTypes as merge,
  mergeVerificationStacks as mergeStacks, verificationDiagnosticCatalog,
} from '@sharpforge/cil';

const handle = name => Object.freeze({ name });
const root = type(Kind.Object, handle('System.Object'));
const classType = handle('Example.Class');
const valueType = handle('Example.Struct');
const values = {
  I: type(Kind.Int32), J: type(Kind.Int64), N: type(Kind.NativeInt), F: type(Kind.Float),
  O: type(Kind.Object, classType), P: type(Kind.ManagedPointer, valueType), Z: type(Kind.Null),
  B: type(Kind.Boxed, valueType), U: type(Kind.UninitializedThis, classType),
  R: type(Kind.ReadonlyPointer, valueType), V: type(Kind.Value, valueType), T: type(Kind.TypedReference),
};
const relations = {
  isAssignableTo: (source, target) => source.type === target.type || target === root,
  commonSupertype: () => root,
  isPointerElementAssignableTo: (source, target) => source === target,
};
const fails = code => error => error.name === 'CilError' && error.code === code;

test('all 144 verification category pairs follow the stack merge table in both directions', () => {
  const mixed = { OZ: values.O, ZO: values.O, BZ: values.B, ZB: values.B,
    OB: root, BO: root, PR: values.R, RP: values.R, IN: values.N, NI: values.I };
  for (const [left, incoming] of Object.entries(values)) {
    for (const [right, stored] of Object.entries(values)) {
      const expected = left === right ? stored : mixed[left + right];
      if (expected) assert.equal(merge(incoming, stored, relations), expected, left + right);
      else assert.throws(() => merge(incoming, stored, relations), fails('CILV0002'), left + right);
    }
  }
});

test('reference relation seam preserves class, interface, boxed and array covariance joins', () => {
  const names = ['Animal', 'Dog', 'Cat', 'IBase', 'ILeft', 'IRight', 'Boxed', 'Animal[]', 'Dog[]', 'Cat[]',
    'Animal[][]', 'Dog[][]', 'Cat[][]'];
  const nominal = Object.fromEntries(names.map(name => [name, type(name === 'Boxed' ? Kind.Boxed : Kind.Object, handle(name))]));
  // Explicit metadata facts supplied by a host, not a second loader or hierarchy algorithm.
  const ancestors = {
    Dog: ['Animal', 'ILeft', 'IBase'], Cat: ['Animal'], ILeft: ['IBase'], IRight: ['IBase'], Boxed: ['IBase'],
    'Dog[]': ['Animal[]'], 'Cat[]': ['Animal[]'], 'Dog[][]': ['Animal[][]'], 'Cat[][]': ['Animal[][]'],
  };
  const common = { 'Dog,Cat': 'Animal', 'ILeft,IRight': 'IBase', 'Dog[],Cat[]': 'Animal[]',
    'Dog[][],Cat[][]': 'Animal[][]' };
  const metadata = {
    isAssignableTo: (source, target) => source === target || target === root ||
      (ancestors[source.type.name] ?? []).includes(target.type.name),
    commonSupertype: (source, target) => nominal[common[[source.type.name, target.type.name].join(',')]] ?? root,
  };
  for (const [left, right, expected] of [
    ['Dog', 'Animal', 'Animal'], ['ILeft', 'IBase', 'IBase'], ['Boxed', 'IBase', 'IBase'],
    ['Dog', 'Cat', 'Animal'], ['ILeft', 'IRight', 'IBase'], ['Dog[]', 'Cat[]', 'Animal[]'],
    ['Dog[][]', 'Cat[][]', 'Animal[][]'],
  ]) assert.equal(merge(nominal[left], nominal[right], metadata), nominal[expected]);
  assert.equal(merge(nominal.Dog, nominal.ILeft, metadata), nominal.ILeft);
  assert.equal(merge(nominal.Animal, nominal.Boxed, metadata), root);
});

test('controlled mutability is preserved and pointer relations never use reference covariance', () => {
  const signed = handle('int32');
  const unsigned = handle('uint32');
  const writable = type(Kind.ManagedPointer, signed);
  const readonly = type(Kind.ReadonlyPointer, unsigned);
  let calls = 0;
  const metadata = { isPointerElementAssignableTo(source, target) {
    calls++;
    return source === signed && target === unsigned;
  } };
  assert.equal(merge(writable, readonly, metadata), readonly);
  assert.equal(merge(readonly, writable, metadata), readonly);
  assert.equal(calls, 2);
  const unrelated = type(Kind.ReadonlyPointer, handle('other'));
  assert.throws(() => merge(writable, unrelated, relations), fails('CILV0002'));
  assert.throws(() => merge(values.O, writable, relations), fails('CILV0002'));
});

test('nominal identity, constructor state and metadata-dependent unknowns are explicit', () => {
  assert.equal(merge(type(Kind.Object, classType), values.O), values.O);
  assert.throws(() => merge(type(Kind.Object, handle('Example.Class')), values.O), fails('CILV0003'));
  assert.throws(() => merge(values.U, values.O, relations), fails('CILV0002'));
  assert.throws(() => merge(values.U, type(Kind.UninitializedThis, handle('other'))), fails('CILV0002'));
  assert.throws(() => merge(values.V, type(Kind.Value, handle('other'))), fails('CILV0002'));
  assert.throws(() => merge(values.P, type(Kind.ManagedPointer, handle('other'))), fails('CILV0003'));
  assert.throws(() => merge(values.O, values.B, { isAssignableTo: () => false }), fails('CILV0003'));
});

test('factories and metadata adapters reject malformed values without coercing nominal identities', () => {
  for (const [kind, nominal] of [['missing', null], [Kind.Int32, classType], [Kind.Object, null], [Kind.Object, 'C']]) {
    assert.throws(() => type(kind, nominal), fails('CILV0001'));
  }
  assert.ok(Object.isFrozen(values.O));
  assert.equal(type(Kind.Int32), values.I);
  assert.throws(() => { values.O.kind = Kind.Int32; }, TypeError);
  for (const fake of [null, {}, { ...values.O }, Object.create(Object.getPrototypeOf(values.O))]) {
    assert.throws(() => merge(fake, values.O), fails('CILV0001'));
  }
  assert.throws(() => merge(values.O, values.B, { isAssignableTo: () => 1 }), fails('CILV0006'));
  for (const common of [values.I, values.O, null, {}]) {
    assert.throws(() => merge(values.O, values.B, { isAssignableTo: () => false, commonSupertype: () => common }), fails('CILV0006'));
  }
  assert.equal(Object.keys(verificationDiagnosticCatalog).length, 6);
});

test('stack merges enforce equal heights, own their results and bound work before allocation', () => {
  const incoming = [values.Z, values.P];
  const stored = [values.O, values.R];
  const merged = mergeStacks(incoming, stored);
  assert.deepEqual(merged, [values.O, values.R]);
  assert.ok(Object.isFrozen(merged));
  incoming[0] = values.I;
  stored[1] = values.I;
  assert.deepEqual(merged, [values.O, values.R]);
  assert.deepEqual(mergeStacks([], [], { maxStack: 0 }), []);
  assert.throws(() => mergeStacks([], [values.I]), fails('CILV0002'));
  assert.throws(() => mergeStacks(null, []), fails('CILV0001'));
  assert.throws(() => mergeStacks([values.I], [values.I], { maxStack: 0 }), fails('CILV0004'));
  for (const maxStack of [-1, 65536, NaN, 1.5]) assert.throws(() => mergeStacks([], [], { maxStack }), fails('CILV0004'));
  assert.equal(mergeStacks(Array(65535).fill(values.I), Array(65535).fill(values.I)).length, 65535);
  assert.throws(() => mergeStacks(new Array(65536), []), fails('CILV0004'));
  assert.throws(() => mergeStacks(new Array(1), new Array(1)), fails('CILV0001'));
});

test('pre-cancelled and interrupted merges produce the cancellation diagnostic', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => mergeStacks([], [], { signal: controller.signal }), fails('CILV0005'));
  const running = new AbortController();
  const metadata = { isAssignableTo() { running.abort(); return true; } };
  assert.throws(() => mergeStacks([values.O, values.I], [values.B, values.I], {
    relations: metadata, signal: running.signal,
  }), fails('CILV0005'));
});
