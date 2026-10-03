import assert from 'node:assert/strict';
import {createBclRegistry} from '@sharpforge/bcl-core';

export async function smoke({api}) {
  const registry = createBclRegistry([api.closedCollectionsModule]);
  const methods = [];
  const contract = {
    define() {},
    member(owner, name, parameters, result) { methods.push({owner, name, parameters, result}); },
    ctor(owner, parameters = []) { this.member(owner, '.ctor', parameters, owner); },
    prop(owner, name, type, value, readOnly = false) {
      this.member(owner, 'get_' + name, [], type);
      if (!readOnly) this.member(owner, 'set_' + name, [type], 'void');
    }
  };
  // Registry contribution helpers are callable independently of their containing object.
  contract.ctor = contract.ctor.bind(contract);
  contract.prop = contract.prop.bind(contract);
  registry.register(contract);
  assert(methods.some(member => member.owner === 'System.Collections.Generic.List`1<int>' && member.name === 'Add'));
  assert.equal(api.closedCollectionsModule.families.length, 6);
  assert.deepEqual(registry.invoke({bclHost: {frameworkType: () => null}}, {owner: 'unknown'}, []), {handled: false});
}
