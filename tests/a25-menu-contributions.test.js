import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuRegistry} from '../apps/studio/menus/registry.js';

const gitMenu = () => ({id: 'git', title: 'Git', mnemonic: 'g', before: 'build', commands: ['git.clone', 'git.changes']});

test('top-menu contributions are isolated command snapshots with identity-safe disposal', () => {
  const registry = createMenuRegistry();
  const descriptor = gitMenu();
  const remove = registry.registerTopMenu(descriptor);
  descriptor.commands.push('changed');
  descriptor.title = 'Changed';
  const snapshot = registry.topMenus();
  assert.deepEqual(snapshot, [gitMenu()]);
  snapshot[0].commands.pop();
  snapshot[0].title = 'Changed again';
  assert.deepEqual(registry.topMenus(), [gitMenu()]);
  assert.throws(() => registry.registerTopMenu(gitMenu()), /Duplicate/);
  remove();
  const next = registry.registerTopMenu(gitMenu());
  remove();
  assert.deepEqual(registry.topMenus(), [gitMenu()]);
  next();
  assert.deepEqual(registry.topMenus(), []);
  const removeInherited = registry.registerTopMenu(Object.create(gitMenu()));
  assert.deepEqual(registry.topMenus(), [gitMenu()]);
  removeInherited();
  registry.registerTopMenu(gitMenu());
  registry.dispose();
  assert.deepEqual(registry.topMenus(), []);
});

test('top menus reject callbacks and malformed descriptors before changing the registry', () => {
  const registry = createMenuRegistry();
  let executed = false;
  for (const descriptor of [
    null, () => { executed = true; }, {...gitMenu(), execute() { executed = true; }},
    {...gitMenu(), commands: [() => { executed = true; }]}, {...gitMenu(), commands: [{id: 'git.clone'}]},
    {...gitMenu(), commands: ['git.clone', 'git.clone']}, {...gitMenu(), commands: []}, {...gitMenu(), commands: Array(1)},
    {...gitMenu(), id: 'two words'}, {...gitMenu(), title: ' '}, {...gitMenu(), mnemonic: 'gg'},
    {...gitMenu(), before: () => 'build'}, {...gitMenu(), commands: ['git.clone()']}
  ]) {
    assert.throws(() => registry.registerTopMenu(descriptor), TypeError);
    assert.deepEqual(registry.topMenus(), []);
  }
  assert.equal(executed, false);
});

test('context menus retain lazy callbacks and old disposers cannot remove new registrations', () => {
  const registry = createMenuRegistry();
  let calls = 0;
  const remove = registry.registerMenu('explorer', label => { calls++; return [[label, 'open']]; });
  registry.registerTopMenu(gitMenu());
  assert.equal(calls, 0);
  assert.deepEqual(registry.items('explorer', 'Open this file'), [['Open this file', 'open']]);
  assert.equal(calls, 1);
  registry.dispose();
  registry.registerMenu('explorer', [['New registration', 'new']]);
  remove();
  assert.deepEqual(registry.items('explorer'), [['New registration', 'new']]);
});
