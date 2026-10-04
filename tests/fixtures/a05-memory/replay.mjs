import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {livePinCount} from '../../../../packages/runtime/src/execution/pinned.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = new URL('./', import.meta.url);

test('Roslyn FieldRVA, overlapping Copy, rectangular bounds, spans and pins replay the captured CoreCLR result', async () => {
  const report = JSON.parse(await readFile(fileURLToPath(new URL('native.json', directory)), 'utf8'));
  const source = await readFile(fileURLToPath(new URL('Program.cs', directory)));
  const bytes = new Uint8Array(Buffer.from(report.image.bytes, 'base64'));
  assert.equal(digest(source), report.sourceSHA256);
  assert.equal(digest(bytes), report.image.sha256);
  assert.ok(report.toolchain.roslyn.version && report.toolchain.runtime);
  assert.equal(report.execution.exitCode, 0);
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.metadata.rows[29].length, report.fieldRVA);
  assert.ok(report.initializers > 0);
  for (const options of [{}, {nativeIntBits: 64, preciseRootLiveness: true}]) {
    const vm = new CilVirtualMachine(bytes, options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, report.execution.stdout.replaceAll('\r\n', '\n'));
      assert.equal(livePinCount(vm), 0);
    } finally { vm.stop(); }
  }
});
