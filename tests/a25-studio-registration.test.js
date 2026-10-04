import test from 'node:test';
import assert from 'node:assert/strict';
import { registerGitStudio } from '../apps/studio/git-studio.js';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { createMenuRegistry } from '../apps/studio/menus/registry.js';
import { createToolRegistry } from '../apps/studio/tools/registry.js';
import { createServiceRegistry } from '../apps/studio/services/registry.js';
import { createArtifactFilters } from '../apps/studio/services/artifacts.js';

test('Git shell registers distinct merge commands in the actual registry and disposes its contributions', async t => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = {
    createElement: () => ({ dataset: {}, setAttribute() {}, remove() {} }),
    querySelector: () => null
  };
  const commands = createCommandRegistry();
  const menus = createMenuRegistry();
  const tools = createToolRegistry();
  const services = createServiceRegistry();
  services.register('commands', () => commands);
  services.register('menus', () => menus);
  services.register('tools', () => tools);
  services.register('artifacts', () => createArtifactFilters());
  t.after(() => services.dispose());
  const shown = [];
  const registration = registerGitStudio({ services, toolDefinitions: [], showPanel: id => shown.push(id) });
  assert.equal(services.get('git'), registration);
  const titles = new Map(commands.list().map(([id, title]) => [id, title]));
  assert.equal(titles.get('git.merge'), 'Merge Branch…');
  assert.equal(titles.get('git.mergeConflicts'), 'Merge Conflicts');
  assert.ok(menus.items('window').some(([title, command]) => title === 'Merge Conflicts' && command === 'git.mergeConflicts'));
  assert.ok(menus.items('git').some(item => item?.[0] === 'Merge Branch…' && item[1] === 'git.merge'));
  await commands.execute('git.mergeConflicts');
  assert.deepEqual(shown, ['git-merge']);
  assert.equal(tools.definitions().length, 9);
  registration.dispose();
  assert.deepEqual(commands.list(), []);
  assert.deepEqual(menus.items('git'), []);
  assert.deepEqual(tools.definitions(), []);
});
