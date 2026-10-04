import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { coreAuthority } from './fixtures/a03-type-categories/input.js';
import { fieldFixture, fieldAuthority } from './fixtures/verifier-fields/input.js';
import { managedFixture } from './managed-fixtures.js';

test('numeric typed verification skips operand display and needs no resource preparation context', () => {
  const inspector = new AssemblyInspector(managedFixture({ entry: null, methods: [
    { name: 'Constant', result: 'int', body: writer => writer.op('ldc.i4.1').op('ret') },
  ] }));
  inspector.describeToken = () => { throw new Error('typed verification requested display'); };
  assert.equal(verifyCilMethodTypes(inspector, 0x06000001).status, 'verified');
  assert.equal(inspector.cache.size, 0);
  assert.equal(inspector.decodedMethods.size, 1);
});

test('unreachable field operands retain strict canonical token checks after display decoding is omitted', () => {
  for (const token of [0x0400ffff, 0x02000002]) {
    const input = fieldFixture({ name: 'UnreachableField', body: writer => writer.op('ret').op('ldfld', token).op('pop').op('ret') });
    const coreTypes = fieldAuthority(coreAuthority(), input);
    const report = verifyCilMethodTypes(input.bytes, input.method, { coreTypes });
    assert.equal(report.status, 'rejected');
    assert.equal(report.diagnostics[0].code, 'CILVM0001');
    assert.equal(report.diagnostics[0].offset, 1);
  }
});

test('missing policies stop before inspector-backed preparation is requested', () => {
  const input = fieldFixture({ name: 'UnsupportedFirst', body(writer, context) {
    writer.op('ldsfld', context.members['Owner.Shared']).op('pop').op('ldtoken', context.types.Owner).op('pop').op('ret');
  } });
  const coreTypes = { resolveType() { throw new Error('preflight must finish before metadata preparation'); } };
  const report = verifyCilMethodTypes(input.bytes, input.method, { coreTypes });
  assert.equal(report.status, 'unknown');
  assert.equal(report.diagnostics[0].diagnostic, 'UnsupportedOpcode');
});
