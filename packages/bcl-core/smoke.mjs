import assert from 'node:assert/strict';

// The package verifier copies this file into an isolated offline tarball install.
export async function smoke({api}) {
  const registry = api.createBclRegistry(api.bclModules);
  assert(registry.modules.some(module => module.families.includes('string')));
  const host = {
    value: value => value,
    fault: (name, message) => Object.assign(new Error(message), {name})
  };
  assert.equal(api.invokeLegacyBclBuiltin(host, 'int.Parse', ['-42']), -42);
  assert.throws(() => api.invokeLegacyBclBuiltin(host, 'int.Parse', ['bad']), {name: 'FormatException'});
}
