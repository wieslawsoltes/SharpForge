import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';
import { contextFixture } from './clr-context-fixtures.js';

const inputs = [
  ['Buffer', bytes => Buffer.from(bytes)],
  ['offset Buffer subarray', bytes => {
    const backing = Buffer.alloc(bytes.length + 32, 0xcc);
    backing.set(bytes, 17);
    return backing.subarray(17, 17 + bytes.length);
  }],
];

for (const [name, createInput] of inputs) {
  test(`CLR stream loading owns ${name} bytes after the caller mutates them`, async () => {
    const input = createInput(contextFixture('Owned'));
    const context = new AssemblyLoadSession().defaultContext;
    const module = (await context.loadFromStream(input)).manifestModule;
    const expectedCode = Array.from(module.methodBody(0x06000001).code);
    input.fill(0);
    assert.deepEqual(Array.from(module.methodBody(0x06000001).code), expectedCode);
    assert.equal(module.string(module.row(0x02000002)[1]), 'Program');
  });

  test(`CLR method and blob snapshots from ${name} do not alias retained metadata`, async () => {
    const context = new AssemblyLoadSession().defaultContext;
    const module = (await context.loadFromStream(createInput(contextFixture('Snapshots')))).manifestModule;
    const body = module.methodBody(0x06000001);
    const expectedCode = Array.from(body.code);
    body.code.fill(0);
    assert.deepEqual(Array.from(module.methodBody(0x06000001).code), expectedCode);
    const signatureIndex = module.row(0x06000001)[4];
    const blob = module.blob(signatureIndex);
    const expectedBlob = Array.from(blob);
    blob.fill(0);
    assert.deepEqual(Array.from(module.blob(signatureIndex)), expectedBlob);
  });
}
