import test from 'node:test';
import assert from 'node:assert/strict';
import {registerGitStudio} from '../apps/studio/git-studio.js';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {createMenuRegistry} from '../apps/studio/menus/registry.js';
import {createToolRegistry} from '../apps/studio/tools/registry.js';
import {createServiceRegistry} from '../apps/studio/services/registry.js';
import {createArtifactFilters} from '../apps/studio/services/artifacts.js';

test('Git registers the same lazy command IDs for legacy and native menu hosts and removes only its own contributions', async t => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = {
    createElement: () => ({dataset: {}, setAttribute() {}, remove() {}}),
    querySelector: () => null
  };
  const commands = createCommandRegistry();
  const menus = createMenuRegistry();
  const services = createServiceRegistry();
  const artifacts = createArtifactFilters();
  services.register('commands', () => commands);
  services.register('menus', () => menus);
  services.register('tools', () => createToolRegistry());
  services.register('artifacts', () => artifacts);
  t.after(() => services.dispose());
  const other = {id: 'other', title: 'Other', mnemonic: 'o', commands: ['other.open']};
  menus.registerTopMenu(other);
  const shown = [];
  const registration = registerGitStudio({services, toolDefinitions: [], showPanel: id => shown.push(id)});
  const git = menus.topMenus().find(menu => menu.id === 'git');
  assert.deepEqual(git, {
    id: 'git', title: 'Git', mnemonic: 'g', before: 'build',
    commands: menus.items('git').filter(Boolean).map(([, command]) => command)
  });
  assert.ok(git.commands.includes('git.clone'));
  const registered = new Set(commands.list().map(([id]) => id));
  assert.ok(git.commands.every(id => registered.has(id)));
  assert.deepEqual(shown, []);
  // Unopened menus do not construct a workbench or require worker/repository host services.
  const artifact = {name: 'example.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('example')};
  assert.deepEqual(await artifacts.prepare({name: artifact.name, content: artifact.bytes, mimeType: artifact.mimeType}), artifact);
  await commands.execute('git.changes');
  assert.deepEqual(shown, ['git-changes']);
  registration.dispose();
  registration.dispose();
  assert.deepEqual(menus.topMenus(), [other]);
  assert.deepEqual(menus.items('git'), []);
  assert.deepEqual(commands.list(), []);
});
