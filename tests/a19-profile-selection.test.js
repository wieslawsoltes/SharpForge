import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { mountStartupTarget } from '../apps/studio/workbench/startup-target.js';
import { fakeWorkers, fakeRuntime, compileResult } from './a19-session-fixtures.js';
import { sessionDomRoot, descendants } from './a19-session-dom-fixture.js';

function fixture() {
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? compileResult() : fakeRuntime(message, worker));
  const services = createWorkbenchServices({ workerFactory: fake.factory, projects: [
    { id: 'A', outputType: 'exe', files: [] }, { id: 'B', outputType: 'exe', files: [] }
  ] });
  services.profiles.set('A', { id: 'alpha', arguments: ['alpha'] });
  services.profiles.set('B', { id: 'beta', arguments: ['beta'] });
  return services;
}

test('startup target switching preserves each project selected profile and starts that target', async () => {
  const services = fixture();
  services.startup.select('A', { profile: 'alpha' });
  const root = sessionDomRoot();
  const mounted = mountStartupTarget(root, services);
  const target = descendants(root, element => element.attributes['aria-label'] === 'Startup target')[0];
  const profile = descendants(root, element => element.attributes['aria-label'] === 'Launch profile')[0];
  target.value = 'B';
  target.dispatchEvent(new Event('change'));
  assert.equal(services.startup.entries[0].profile, 'beta');
  assert.equal(profile.value, 'beta');
  const launched = await services.launches.start();
  const session = services.sessions.get(launched.started[0]);
  assert.equal(session.projectId, 'B');
  assert.equal(session.profileId, 'beta');
  assert.deepEqual(session.lastLaunch.programArguments, ['beta']);
  target.value = 'A';
  target.dispatchEvent(new Event('change'));
  assert.equal(services.startup.entries[0].profile, 'alpha');
  mounted.dispose();
  assert.equal(root.children.length, 0);
  services.dispose();
});

test('current-selection startup and new-instance commands honor the current project selected profile', async () => {
  const services = fixture();
  services.startup.configure({ mode: 'currentSelection' });
  const launched = await services.launches.start({ currentProjectId: 'B' });
  const current = services.sessions.get(launched.started[0]);
  assert.equal(current.profileId, 'beta');
  assert.deepEqual(current.lastLaunch.programArguments, ['beta']);
  const again = await services.launches.startNewInstance('A');
  assert.equal(services.sessions.get(again.started[0]).profileId, 'alpha');
  services.dispose();
});

test('changing a startup profile preserves its start-without-debugging action', () => {
  const services = fixture();
  services.profiles.set('A', { id: 'alternative' });
  services.startup.select('A', { profile: 'alpha', debug: false });
  const root = sessionDomRoot();
  const mounted = mountStartupTarget(root, services);
  const profile = descendants(root, element => element.attributes['aria-label'] === 'Launch profile')[0];
  profile.value = 'alternative';
  profile.dispatchEvent(new Event('change'));
  assert.equal(services.startup.entries[0].profile, 'alternative');
  assert.equal(services.startup.entries[0].action, 'startWithoutDebugging');
  mounted.dispose();
  services.dispose();
});
