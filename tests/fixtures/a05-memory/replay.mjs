import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {digest, readMemoryRecording} from './recording.mjs';

const directory = new URL('./', import.meta.url);

test('Roslyn FieldRVA, overlapping Copy, rectangular bounds, spans and pins replay the captured CoreCLR result', async () => {
  const recording = await readMemoryRecording(directory);
  const source = await readFile(fileURLToPath(new URL('Program.cs', directory)));
  const {bytes} = recording;
  assert.equal(digest(source), recording.sourceSHA256);
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.metadata.rows[29].length, recording.fieldRVA);
  let initializers = 0;
  for (const method of inspector.methods.values()) {
    for (const instruction of inspector.getMethod(method.token).instructions) {
      if (instruction.name === 'call' && inspector.resolveToken(instruction.operand).name === 'InitializeArray') initializers++;
    }
  }
  assert.ok(recording.fieldRVA > 0 && recording.initializers > 0);
  assert.equal(initializers, recording.initializers);
  for (const options of [{}, {nativeIntBits: 64, preciseRootLiveness: true}]) {
    const vm = new CilVirtualMachine(bytes, options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, recording.output.replaceAll('\r\n', '\n'));
      assert.equal(vm.heap.stats.hostStrongHandles, 0, 'fixed leases release their strong handles after execution');
    } finally { vm.stop(); }
  }
});
