import test from 'node:test';
import assert from 'node:assert/strict';
import { readPE } from '@sharpforge/cil';
import { RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => readPE(managedFixture({ methods: [{ name: 'Method', noBody: true }], decorate }), { inspection: true });
const moduleFor = pe => new RuntimeModule({ ensureUsable() {} }, pe);
const limited = error => error.code === LoadErrorCode.LimitExceeded;

test('CLR MethodDef rejects excessive name bytes before the metadata decoder materializes them', () => {
  const pe = fixture(({ md }) => { md.rows[6][0][3] = md.string('x'.repeat(16 * 1024 + 1)); });
  const index = pe.metadata.row(0x06000001)[3];
  const string = pe.metadata.string;
  let reads = 0;
  pe.metadata.string = value => { if (value === index) reads++; return string(value); };
  assert.throws(() => moduleFor(pe).methodDefinition(0x06000001), limited);
  assert.equal(reads, 0);
});

test('CLR MethodDef signature rejects an excessive heap view before making its defensive copy', () => {
  const pe = fixture(({ md }) => { md.rows[6][0][4] = md.blob(new Uint8Array(1024 * 1024 + 1)); });
  const index = pe.metadata.row(0x06000001)[4];
  const blob = pe.metadata.blob;
  let copies = 0;
  pe.metadata.blob = value => {
    const view = blob(value);
    return value !== index ? view : new Proxy(view, { get(target, key) {
      if (key === Symbol.iterator) return () => { copies++; throw new Error('Signature copied before checking its size'); };
      return Reflect.get(target, key, target);
    } });
  };
  const method = moduleFor(pe).methodDefinition(0x06000001);
  assert.equal(copies, 0);
  assert.throws(() => method.signature, limited);
  assert.equal(copies, 0);
});

test('CLR MethodDef byte preflight preserves its existing 4096 UTF-16-unit name boundary', () => {
  for (const name of ['界'.repeat(4096), '😀'.repeat(2048)]) {
    const method = moduleFor(fixture(({ md }) => { md.rows[6][0][3] = md.string(name); })).methodDefinition(0x06000001);
    assert.equal(method.name, name);
    assert.equal(method.signature.kind, 'method');
  }
  for (const name of ['界'.repeat(4097), '😀'.repeat(2049)]) {
    const module = moduleFor(fixture(({ md }) => { md.rows[6][0][3] = md.string(name); }));
    assert.throws(() => module.methodDefinition(0x06000001), limited);
  }
});
