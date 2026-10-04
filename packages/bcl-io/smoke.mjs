import assert from 'node:assert/strict';
import {createBclRegistry} from '@sharpforge/bcl-core';

export async function smoke({api}) {
  const types = new Map();
  const members = [];
  api.registerIoModules({
    define(name, options) { types.set(name, options); },
    member(owner, name, parameters, result) { members.push({owner, name, parameters, result}); },
    ctor(owner, parameters) { members.push({owner, name: '.ctor', parameters}); },
    prop(owner, name, result) {
      members.push({owner, name: 'get_' + name, parameters: [], result});
      members.push({owner, name: 'set_' + name, parameters: [result], result: 'void'});
    }
  });
  assert.equal(types.get('System.IO.TextReader').isAbstract, true);
  assert.equal(types.get('System.IO.StringReader').base, 'System.IO.TextReader');
  assert.equal(types.get('System.IO.TextWriter').isAbstract, true);
  assert.equal(types.get('System.IO.StringWriter').base, 'System.IO.TextWriter');
  assert.equal(members.length, 26);
  assert.deepEqual(members.slice(-4).map(member => [member.name, member.parameters]), [
    ['Write', ['char[]']], ['Write', ['char[]', 'int', 'int']],
    ['WriteLine', ['char[]']], ['WriteLine', ['char[]', 'int', 'int']]
  ]);
  assert.equal(members.filter(member => /System\.IO\.(TextReader|StringReader)$/.test(member.owner)).length, 9);
  assert(members.some(member => member.name === 'ReadLine' && member.result === 'string'));
  assert.equal(api.ioModules[0], api.stringReaderModule);
  assert.equal(api.ioModules[1], api.stringWriterModule);
  assert(members.some(member => member.name === 'get_NewLine' && member.result === 'string'));
  const registry = createBclRegistry(api.ioModules);
  assert.deepEqual(registry.invoke({bclHost: {frameworkType: () => null}}, {owner: 'unknown'}, []), {handled: false});
}
