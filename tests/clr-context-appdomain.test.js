import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, LoadErrorCode, RuntimeAppDomain, RuntimeAppContext } from '../packages/clr/src/index.js';
import { contextFixture } from './clr-context-fixtures.js';

test('CLR AppDomain assembly events and AppContext configuration are session isolated', async () => {
  const domain = new RuntimeAppDomain({ appContext: new RuntimeAppContext({
    baseDirectory: '/application', properties: { 'Feature.Enabled': true, 'Application.Name': 'Example' },
  }) });
  const events = [];
  domain.onAssemblyLoad(assembly => events.push(assembly));
  domain.onAssemblyResolve(({ assemblyName }) => assemblyName.name === 'Plugin' ? contextFixture('Plugin') : null);
  const assembly = await domain.load('Plugin');
  assert.equal(domain.currentDomain, domain);
  assert.deepEqual(domain.getAssemblies(), [assembly]);
  assert.deepEqual(events, [assembly]);
  assert.deepEqual(new RuntimeAppDomain().getAssemblies(), []);
  assert.equal(domain.baseDirectory, '/application');
  assert.deepEqual(domain.appContext.tryGetSwitch('Feature.Enabled'), { found: true, enabled: true });
  assert.equal(domain.appContext.getData('Application.Name'), 'Example');
  domain.appContext.setSwitch('Feature.Enabled', false);
  domain.appContext.setData('Result', 42);
  assert.deepEqual(domain.appContext.tryGetSwitch('Missing'), { found: false, enabled: false });
  assert.equal(domain.appContext.getData('Result'), 42);
  domain.onTypeResolve(({ name }) => name === 'Plugin.Widget' ? assembly : null);
  assert.equal(await domain.resolveType('Plugin.Widget'), assembly);
});

