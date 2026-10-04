import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AssemblyInspector, memoryMethodDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';

const fixture = new URL('./fixtures/a05/unsafe-unbox-native/', import.meta.url);
const root = new URL('../', import.meta.url);
const capture = JSON.parse(readFileSync(new URL('capture.json', fixture), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');

for (const item of capture.captures) test(`actual SDK8 ${item.name} DLL retains native Unsafe.Unbox behavior`, () => {
  const bytes = readFileSync(new URL(item.assembly, fixture));
  const expected = readFileSync(new URL(item.expected, root));
  assert.equal(hash(bytes), item.assemblySha256);
  assert.equal(hash(expected), item.expectedSha256);
  assert.equal(hash(readFileSync(new URL(item.source, root))), item.sourceSha256);
  assert.equal(item.dotnetSdk, '8.0.425');
  assert.equal(item.targetFramework, 'net8.0');
  assert.equal(item.native.exitCode, 0);
  assert.equal(item.native.output, expected.toString());
  assert.match(item.originalSharpForgeError, /Unsafe::Unbox.*not implemented/);
  const inspector = new AssemblyInspector(bytes);
  const methods = inspector.metadata.rows[43] ?? [];
  const unboxCalls = methods.map((_, index) => inspector.resolveToken(0x2b000001 + index))
    .filter(method => method.owner === 'System.Runtime.CompilerServices.Unsafe' && method.name === 'Unbox');
  assert.equal(unboxCalls.length, item.name === 'enum-unboxing' ? 2 : 1);
  for (const descriptor of unboxCalls) {
    assert.equal(descriptor.signature.genericArity, 1);
    assert.equal(descriptor.signature.returnType, '!!0&');
    assert.deepEqual(descriptor.signature.parameters, ['object']);
    assert.equal(memoryMethodDefinition(descriptor)?.operation, 'unboxReference');
  }
  const vm = new CilVirtualMachine(inspector);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, item.native.output);
  } finally { vm.stop(); }
});
