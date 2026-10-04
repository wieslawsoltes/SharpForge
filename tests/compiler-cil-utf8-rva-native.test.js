import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly, createReferenceSet } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { referenceWithoutSpanConstructor } from './fixtures/utf8-rva/metadata.mjs';
import { compileNative, requireNativeSuccess, resolveToolchain, runNative, runtimeConfig } from './fixtures/utf8-rva/native.mjs';

const fixtureRoot = new URL('./fixtures/utf8-rva/', import.meta.url);
const pack = loadReferencePack();
const source = readFileSync(new URL('Utf8Literals.cs', fixtureRoot), 'utf8').replace(/\r\n/g, '\n');

test('A02-T77 actual CLR spans preserve bytes, terminal zero, GC lifetime and zero literal allocations', {
  skip: pack ? false : 'no .NET reference pack installed',
}, async () => {
  const toolchain = await resolveToolchain();
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-utf8-rva-'));
  try {
    const consumer = join(scratch, 'InspectUtf8.dll');
    requireNativeSuccess(await compileNative(toolchain, {
      source: fileURLToPath(new URL('InspectUtf8.cs', fixtureRoot)), output: consumer, executable: true,
      references: [...toolchain.references, fileURLToPath(new URL('Utf8Literals.dll', fixtureRoot))],
    }));
    const fallback = createReferenceSet(pack.pack.files.map(path => ({ display: path,
      bytes: basename(path) === 'System.Runtime.dll' ? referenceWithoutSpanConstructor(readFileSync(path), 'pointer').bytes : readFileSync(path) })));
    for (const [mode, references] of [['registry', undefined], ['references', pack.references], ['fallback', fallback]]) {
      const directory = join(scratch, mode);
      mkdirSync(directory);
      const result = compileToAssembly(source, { name: 'Utf8Literals', outputKind: 'library', langVersion: '11', references });
      assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), [], mode);
      writeFileSync(join(directory, 'Utf8Literals.dll'), result.assembly);
      copyFileSync(consumer, join(directory, 'InspectUtf8.dll'));
      runtimeConfig(toolchain, join(directory, 'InspectUtf8.runtimeconfig.json'));
      const output = await runNative(toolchain, join(directory, 'InspectUtf8.dll'));
      const expected = readFileSync(new URL(mode === 'fallback' ? 'fallback.out' : 'modern.out', fixtureRoot), 'utf8');
      assert.equal(output, expected.replace(/\r\n/g, '\n'), mode);
      assert.ok(output.includes('after-gc:'));
      assert.equal(output.includes('allocated:0\n'), mode !== 'fallback');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
