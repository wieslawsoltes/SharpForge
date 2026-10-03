import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { MetadataBuilder, readMetadata, readPE, inspectAssembly, loadAssembly, validateMetadata } from '@sharpforge/cil';
import { readPortablePdb } from '@sharpforge/symbols';

function compile(options = {}) {
  const result = compileToIL('public class Part { public static int Value() { return 42; } }',
    { name: 'Part', outputKind: 'netmodule', ...options });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  test(`A03 ${platform} netmodule has Module metadata, no Assembly manifest and no entry point`, () => {
    const result = compile({ platform }), pe = readPE(result.assembly), summary = inspectAssembly(result.assembly);
    assert.equal(pe.metadata.counts[32] ?? 0, 0);
    assert.equal(pe.metadata.string(pe.metadata.rows[0][0][1]), 'Part.netmodule');
    assert.equal(pe.entryPoint, 0);
    assert(pe.characteristics & 0x2000);
    assert.equal(summary.name, 'Part.netmodule');
    assert.equal(summary.version, null);
    assert(summary.types.some(type => type.name === 'Part'));
    assert.equal(validateMetadata(pe.metadata).length, 0);
    assert(result.pdb.length > 0);
    assert(readPortablePdb(result.pdb));
    assert.deepEqual(compile({ platform }).assembly, result.assembly);
    assert.throws(() => loadAssembly(result.assembly), /Netmodules require a containing assembly/);
  });
}

test('A03 module alias, explicit file name, no-symbol and desktop metadata paths preserve module semantics', () => {
  const result = compile({ outputKind: 'module', moduleName: 'Renamed.netmodule', portablePdb: false, framework: 'mscorlib4' });
  const pe = readPE(result.assembly);
  assert.equal(result.pdb, null);
  assert.equal(pe.metadata.string(pe.metadata.rows[0][0][1]), 'Renamed.netmodule');
  assert.equal(pe.directories.import.size, 0, 'A module has no standalone desktop loader thunk');
  const builder = new MetadataBuilder('LowLevel.netmodule', { outputKind: 'netmodule' });
  const metadata = readMetadata(builder.finish());
  assert.equal(metadata.counts[32] ?? 0, 0);
  assert.equal(metadata.string(metadata.rows[0][0][1]), 'LowLevel.netmodule');
});

test('A03 module-only output rejects assembly identity, signing and invalid file names', () => {
  for (const options of [{ assemblyVersion: '1.2.3.4' }, { assemblyCulture: 'en-US' },
    { moduleName: '' }, { moduleName: '../part.netmodule' }, { moduleName: 'a\0b' },
    { publicSign: true }, { delaySign: true }, { signAssembly: true }]) {
    const result = compileToIL('public class Part {}', { outputKind: 'netmodule', ...options });
    assert.equal(result.success, false);
    assert(result.diagnostics.some(value => value.code === 'SF3001'));
  }
  assert.throws(() => new MetadataBuilder('Assembly', { moduleName: 'Invalid.netmodule' }), /only for netmodule/);
});

test('A03 native SRM identifies emitted module-only files without Assembly definitions', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/a03-netmodule/native.json', import.meta.url), 'utf8'));
  assert.match(reference.runtime, /^\.NET /);
  assert.equal(reference.cases.length, 4);
  for (const value of reference.cases) {
    assert.equal(value.isAssembly, false);
    assert.equal(value.name, 'Part.netmodule');
    assert.equal(value.assemblyRows, 0);
    assert.equal(value.entryPoint, 0);
    assert(value.types.includes('Part'));
  }
});
