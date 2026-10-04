import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStudioStartupProject } from '../apps/studio/workbench/studio-startup-project.js';
import { connectStudioStartupSelection } from '../apps/studio/workbench/studio-startup-selection.js';
import { mountStartupTarget } from '../apps/studio/workbench/startup-target.js';
import { studioComposition } from './support/studio-composition.js';
import { sessionDomRoot, descendants } from './a19-session-dom-fixture.js';

const alpha = 'Alpha/Alpha.csproj';
const beta = 'Beta/Beta.csproj';

function setup(context) {
  const fixture = studioComposition();
  context.after(fixture.dispose);
  const { services, state, projects } = fixture;
  const calls = [];
  const host = { services, state, projects, renderWorkspace: () => calls.push('workspace'),
    renderPanel: panel => calls.push(panel), save: () => calls.push('save'), build: () => calls.push('build') };
  context.after(connectStudioStartupSelection({ services, state: () => state }));
  return { ...fixture, calls, host };
}

test('Set as Startup Project preserves both selected profiles and the toolbar agrees with the next F5 launch', async context => {
  const scope = setup(context);
  scope.services.profiles.set(alpha, { id: 'alpha-cli', arguments: ['alpha'] });
  scope.services.profiles.set(beta, { id: 'beta-cli', arguments: ['beta'], environment: { APP: 'beta' } });
  const root = sessionDomRoot();
  const target = mountStartupTarget(root, scope.services);
  context.after(() => target.dispose());
  await selectStudioStartupProject(beta, scope.host);
  assert.equal(scope.state.startupProject, beta);
  assert.equal(scope.services.builds.activeId, beta);
  assert.equal(scope.services.startup.entries[0].profile, 'beta-cli');
  const profile = descendants(root, element => element.attributes['aria-label'] === 'Launch profile')[0];
  assert.equal(profile.value, 'beta-cli');
  const result = await scope.services.launches.start();
  const session = scope.services.sessions.get(result.started[0]);
  assert.equal(session.projectId, beta);
  assert.deepEqual(session.lastLaunch.programArguments, ['beta']);
  assert.deepEqual(session.lastLaunch.environment, { APP: 'beta' });
  assert.equal(scope.services.profiles.selected.get(alpha), 'alpha-cli');
  assert.deepEqual(scope.calls, ['workspace', 'project', 'save', 'build']);
  await selectStudioStartupProject(alpha, scope.host);
  assert.equal(profile.value, 'alpha-cli');
});

test('Set as Startup Project uses the real default profile when no per-project choice exists', async context => {
  const scope = setup(context);
  await selectStudioStartupProject(beta, scope.host);
  assert.equal(scope.services.startup.entries[0].profile, 'default');
  const result = await scope.services.launches.start();
  assert.equal(scope.services.sessions.get(result.started[0]).profileId, 'default');
});

test('invalid or library startup targets leave the selected project and profile unchanged', async context => {
  const scope = setup(context);
  scope.services.profiles.set(alpha, { id: 'keep-alpha' });
  await selectStudioStartupProject(alpha, scope.host);
  const before = scope.services.startup.snapshot();
  scope.calls.length = 0;
  await assert.rejects(selectStudioStartupProject('Missing.csproj', scope.host), /Unknown startup/);
  scope.state.projectSystem.projects.get(beta).outputType = 'library';
  await assert.rejects(selectStudioStartupProject(beta, scope.host), { code: 'STARTUP_LIBRARY' });
  assert.deepEqual(scope.services.startup.snapshot(), before);
  assert.equal(scope.state.startupProject, alpha);
  assert.deepEqual(scope.calls, []);
});
