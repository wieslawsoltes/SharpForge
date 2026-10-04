import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-event-definitions/native-events.json', import.meta.url)));

test('CLR Event identities, raw type tokens and accessor methods match CoreCLR reflection/SRM', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  const owners = new Map();
  for (const expected of native.events) {
    const event = module.eventDefinition(expected.token);
    assert.equal(event.name, expected.name);
    assert.equal(event.declaringType.metadataToken, expected.owner);
    assert.equal(event.flags, expected.flags);
    assert.equal(event.eventTypeToken, expected.eventType);
    assert.equal(event.addMethod?.metadataToken ?? null, expected.add);
    assert.equal(event.removeMethod?.metadataToken ?? null, expected.remove);
    assert.equal(event.raiseMethod?.metadataToken ?? null, expected.raise);
    assert.deepEqual(event.otherMethods.map(method => method.metadataToken), expected.others);
    if (!owners.has(expected.owner)) owners.set(expected.owner, []);
    owners.get(expected.owner).push(event);
  }
  for (const [token, events] of owners) assert.deepEqual(module.eventDefinitions(token), events);
  assert.equal(module.methodBodyReadCount, 0);
});
