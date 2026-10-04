import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { forwardingCorpus, forwardingContext, forwardingCases } from './clr-forwarders-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-forwarders/native-forwarders.json', import.meta.url)));

test('facade, nested, cyclic and consumer TypeRef forwarding agree with native CoreCLR', async () => {
  assert.match(native.runtime, /^\.NET 10\./);
  for (const source of native.sources) {
    const bytes = readFileSync(new URL('../' + source.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
  assert.deepEqual(native.images, [...forwardingCorpus()].map(([name, bytes]) => ({
    name, sha256: createHash('sha256').update(bytes).digest('hex'),
  })));
  assert.equal(native.results.length, forwardingCases.length);
  for (const expected of native.results) {
    const request = expected.request;
    const context = forwardingContext();
    const assembly = await context.loadFromAssemblyName(request.assembly);
    const resolve = () => request.token !== null
      ? context.types.load(assembly.manifestModule, request.token)
      : context.types.find(assembly.manifestModule, request.name);
    if (expected.error) {
      await assert.rejects(resolve(), error => error.managedType === expected.error);
      continue;
    }
    const type = await resolve();
    const target = await context.loadFromAssemblyName('ForwardTarget');
    assert.deepEqual({ request, name: type.fullName, assembly: type.assembly.identity.name,
      token: type.metadataToken, canonical: type === await context.types.find(target.manifestModule, type.fullName) }, expected);
    assert.equal(type, await resolve());
    assert.ok(context.assemblies.every(item => item.manifestModule.methodBodyReadCount === 0));
  }
});
