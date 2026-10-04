import test from 'node:test';
import assert from 'node:assert/strict';
import { readPE } from '@sharpforge/cil';
import { RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => readPE(managedFixture({ methods: [
  { name: 'Method', parameters: ['string'], noBody: true },
], decorate }), { inspection: true });
const limited = error => error.code === LoadErrorCode.LimitExceeded;

test('CLR parameter name byte limits reject before the metadata string decoder runs', () => {
  const pe = fixture(({ md }) => { md.rows[8][0][2] = md.string('x'.repeat(4097)); });
  const index = pe.metadata.row(0x08000001)[2];
  const string = pe.metadata.string;
  let reads = 0;
  pe.metadata.string = value => {
    if (value === index) reads++;
    return string(value);
  };
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  assert.throws(() => module.methodParameters(0x06000001), limited);
  assert.equal(reads, 0);
});

test('CLR parameter Constant blob limits reject the heap view before defensive materialization', () => {
  const pe = fixture(({ md }) => {
    md.rows[8][0][0] = 0x1000;
    md.add(11, [14, 5, md.blob(new Uint8Array(1024 * 1024 + 2))]);
  });
  const index = pe.metadata.row(0x0b000001)[2];
  const blob = pe.metadata.blob;
  let copies = 0;
  pe.metadata.blob = value => {
    const view = blob(value);
    return value !== index ? view : new Proxy(view, { get(target, key) {
      if (key === Symbol.iterator) return () => { copies++; throw new Error('Blob copied before its limit check'); };
      return Reflect.get(target, key, target);
    } });
  };
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  const parameter = module.methodParameters(0x06000001).parameters[0];
  assert.throws(() => parameter.constant, limited);
  assert.equal(copies, 0);
});

test('CLR heap preflight limits count bytes, accept exact boundaries and preserve blob ownership', () => {
  let nameIndex, blobIndex;
  const pe = fixture(({ md }) => {
    nameIndex = md.string('éé');
    blobIndex = md.blob(new Uint8Array([1, 2, 3]));
  });
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  assert.equal(module.string(nameIndex, { maxBytes: 4 }), 'éé');
  assert.throws(() => module.string(nameIndex, { maxBytes: 3 }), limited);
  assert.equal(module.string(0, { maxBytes: 0 }), '');
  const bytes = module.blob(blobIndex, { maxBytes: 3 });
  bytes[0] = 99;
  assert.deepEqual(module.blob(blobIndex, { maxBytes: 3 }), new Uint8Array([1, 2, 3]));
  assert.throws(() => module.blob(blobIndex, { maxBytes: 2 }), limited);
  for (const maxBytes of [-1, 0.5, Infinity, 256 * 1024 * 1024 + 1]) {
    const invalid = error => error.code === LoadErrorCode.InvalidConfiguration;
    assert.throws(() => module.string(nameIndex, { maxBytes }), invalid);
    assert.throws(() => module.blob(blobIndex, { maxBytes }), invalid);
  }
});
