import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

test('CLR isolated assembly identities and metadata match native .NET AssemblyLoadContext', async () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/clr-contexts/native-contexts.json', import.meta.url)));
  assert.equal(reference.distinctTypes, true);
  assert.equal(reference.domainSeesAssemblies, true);
  assert.equal(reference.liveInstanceRetainsContext, true);
  assert.equal(reference.collectedAfterRelease, true);
  const session = new AssemblyLoadSession();
  const handles = [];
  for (let index = 0; index < reference.images.length; index++) {
    const expected = reference.loaded[index];
    const context = session.createContext({ name: `Context${index}`, isCollectible: true });
    const assembly = await context.loadFromStream(Buffer.from(reference.images[index], 'base64'));
    assert.equal(assembly.fullName, expected.fullName);
    assert.equal(assembly.manifestModule.moduleVersionId, expected.mvid);
    assert.equal(assembly.manifestModule.name, expected.moduleName);
    assert.deepEqual((await assembly.getReferencedAssemblies()).map(identity => identity.fullName), expected.references);
    handles.push(assembly.manifestModule.typeIdentity(expected.typeToken));
  }
  assert.notEqual(handles[0], handles[1]);
  assert.equal(session.getAssemblies().length, 2);
});
