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
}, async context => {
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
      const allocationLine = /^allocated:(\d+)$/m;
      const actualAllocation = output.match(allocationLine);
      const expectedAllocation = expected.match(allocationLine);
      assert.ok(actualAllocation && expectedAllocation, mode + ' allocation measurements');
      assert.equal(output.replace(allocationLine, ''), expected.replace(/\r\n/g, '\n').replace(allocationLine, ''), mode);
      assert.ok(output.includes('after-gc:'));
      if (mode === 'fallback') {
        // Array initialization strategies have different runtime costs; positive allocation is the target fallback contract.
        assert.ok(Number(actualAllocation[1]) > 0);
        assert.ok(Number(expectedAllocation[1]) > 0);
      } else {
        assert.equal(actualAllocation[1], '0');
        assert.equal(expectedAllocation[1], '0');
      }
      context.diagnostic(JSON.stringify({ mode, actualAllocatedBytes: Number(actualAllocation[1]),
        roslynAllocatedBytes: Number(expectedAllocation[1]) }));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
