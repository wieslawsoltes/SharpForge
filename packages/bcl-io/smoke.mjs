import assert from 'node:assert/strict';
import {createBclRegistry} from '@sharpforge/bcl-core';

export async function smoke({api}) {
  const types = new Map();
  const members = [];
  api.registerIoModules({
    define(name, options) { types.set(name, options); },
    member(owner, name, parameters, result) { members.push({owner, name, parameters, result}); },
    ctor(owner, parameters) { members.push({owner, name: '.ctor', parameters}); }
  });
  assert.equal(types.get('System.IO.TextReader').isAbstract, true);
  assert.equal(types.get('System.IO.StringReader').base, 'System.IO.TextReader');
  assert.equal(members.length, 7);
  assert(members.some(member => member.name === 'ReadLine' && member.result === 'string'));
  assert.equal(api.ioModules[0], api.stringReaderModule);
  const registry = createBclRegistry(api.ioModules);
  assert.deepEqual(registry.invoke({bclHost: {frameworkType: () => null}}, {owner: 'unknown'}, []), {handled: false});
}
