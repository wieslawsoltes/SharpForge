import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { localReferenceFixture, localReferenceCases } from './fixtures/a03-local-type-references/input.js';

const fixtureURL = new URL('./fixtures/a03-local-type-references/', import.meta.url);
const capture = JSON.parse(readFileSync(new URL('native.json', fixtureURL), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');

test('local TypeRef aliases agree with retained independent CoreCLR Module.ResolveType observations', () => {
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  assert.equal(hash(readFileSync(new URL('input.js', fixtureURL))), capture.inputSHA256);
  assert.equal(hash(readFileSync(new URL('Program.cs', fixtureURL))), capture.templateSHA256);
  const input = localReferenceFixture();
  const bytes = input.bytes();
  assert.equal(hash(bytes), capture.fixtureSHA256);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(capture.assembly, 'base64'));
  const adapter = createMetadataVerificationTypeSystem(new AssemblyInspector(bytes));
  const native = JSON.parse(capture.execution.stdout);
  assert.equal(native.runtime, capture.toolchain.runtime);
  for (const [name, definition] of Object.entries(localReferenceCases)) {
    const token = input.tokens[name];
    const observed = native.types.find(type => type.token === token);
    assert.equal(observed.success, true, name);
    assert.equal(observed.local, true, name);
    assert.equal(observed.definition, input.tokens[definition], name);
    const resolved = adapter.resolveType(token);
    assert.equal(resolved, adapter.resolveType(observed.definition), name);
    if (observed.baseToken !== null) assert.equal(adapter.baseType(resolved.value).value.token, observed.baseToken);
    for (const type of observed.interfaces) {
      assert.equal(adapter.isAssignable(resolved.value, adapter.resolveType(type).value).value, true);
    }
  }
  const nested = native.types.find(type => type.token === input.tokens.nested);
  assert.equal(nested.success, true);
  assert.equal(adapter.resolveType(input.tokens.nested), adapter.resolveType(nested.definition));
  for (const name of ['object', 'open']) {
    assert.equal(native.types.find(type => type.token === input.tokens[name]).success, true, name);
    assert.equal(adapter.resolveType(input.tokens[name]).status, 'unknown', name);
  }
  for (const name of ['missing', 'wrongCase', 'wrongNamespace', 'nestedAsTopLevel']) {
    assert.equal(native.types.find(type => type.token === input.tokens[name]).success, false, name);
    assert.equal(adapter.resolveType(input.tokens[name]).status, 'unknown', name);
  }
});
