import assert from 'node:assert/strict';

/** Verify the public entry point in an isolated package installation. */
export async function smoke({ api }) {
  const provider = new api.AssemblyProvider('memory', [{ identity: 'Example, Version=1.0.0.0', path: 'Example.dll' }]);
  const resolver = new api.AssemblyResolver({ providers: [provider] });
  assert.equal(resolver.resolve('Example').path, 'Example.dll');
  assert.equal(api.AssemblyName.parse('Example, Culture=neutral').culture, '');
  resolver.dispose();
}

export const smokeSteps = [];
