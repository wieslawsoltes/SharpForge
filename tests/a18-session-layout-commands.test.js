import test from 'node:test';
import assert from 'node:assert/strict';
import {DockLayout, createGroup, createSplit} from '@sharpforge/docking';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {contributeDesignerCommands} from '../apps/studio/designer-commands.js';
import {migrateDesignerLayout, designerDocumentKind} from '../apps/studio/designer-layout-migration.js';

test('0.14 designer panels migrate out of every placement without orphaning documents', () => {
  const panels = ['source:A.cs', 'source:B.cs', 'designer-properties', 'output'];
  const old = {
    version: 1,
    root: createSplit('root', 'horizontal', createGroup('documents', ['designer', 'source:A.cs'], 'document'),
      createGroup('tools', ['designer-properties', 'designer-source'])),
    floating: [{id: 'floating', x: 0, y: 0, width: 400, height: 300, root: createGroup('other', ['source:B.cs'], 'document')}],
    autoHide: {left: [], right: [], top: [], bottom: []}, closed: ['output'], activePanel: 'designer'
  };
  const before = structuredClone(old);
  const migrated = migrateDesignerLayout(old, {knownPanels: panels, activeUri: 'A.cs'});
  const layout = new DockLayout(panels.map(id => ({id})), migrated);
  assert.equal(layout.snapshot().activePanel, 'source:A.cs');
  assert.equal(layout.groups().find(group => group.id === 'documents').active, 'source:A.cs');
  assert.deepEqual(old, before);
  assert.ok(!JSON.stringify(migrated).includes('"designer"'));
  assert.ok(!JSON.stringify(migrated).includes('designer-source'));
  assert.equal(typeof migrateDesignerLayout(JSON.stringify(old), {knownPanels: panels}), 'string');
});

test('migration is idempotent, bounds malformed input, and identifies standalone designer documents', () => {
  const state = {version: 1, root: createGroup('documents', [], 'document'), floating: [],
    autoHide: {left: ['designer'], right: [], top: [], bottom: []}, closed: ['designer-source'], activePanel: 'designer'};
  const migrated = migrateDesignerLayout(state);
  assert.deepEqual(migrateDesignerLayout(migrated), migrated);
  assert.deepEqual(migrated.autoHide.left, []);
  assert.deepEqual(migrated.closed, []);
  assert.equal(migrated.activePanel, null);
  assert.equal(designerDocumentKind('Views/Panel.sfdesign.json'), 'design');
  assert.equal(designerDocumentKind('Program.cs'), null);
  assert.throws(() => migrateDesignerLayout({version: 2}), TypeError);
});

test('View Designer and View Code commands use the same URI and exclude incompatible files', async () => {
  const registry = createCommandRegistry();
  let active = 'A.cs';
  const calls = [];
  const documents = {
    state: {active}, get: () => null,
    probe: uri => ({compatible: uri === 'A.cs' || uri === 'B.cs'}),
    open: async (uri, mode) => { calls.push({uri, mode}); return uri; }
  };
  const commands = contributeDesignerCommands(registry, {documents, getActiveUri: () => active});
  await registry.execute('viewDesigner');
  await registry.execute('viewCode');
  assert.deepEqual(calls, [{uri: 'A.cs', mode: 'design'}, {uri: 'A.cs', mode: 'code'}]);
  assert.equal(commands.menuItems({path: 'B.cs', kind: 'source'}).length, 3);
  assert.equal(commands.menuItems({path: 'Other.cs', kind: 'source'}).length, 0);
  active = 'Other.cs';
  assert.equal(commands.canView('design'), false);
  assert.equal(registry.canExecute('viewDesigner'), false);
  // The registry now rejects disabled commands before invoking their handlers.
  await assert.rejects(registry.execute('viewDesigner'), {message: 'Command is unavailable: View Designer'});
  assert.throws(() => commands.viewDesigner(), /compatible/);
  assert.deepEqual(calls, [{uri: 'A.cs', mode: 'design'}, {uri: 'A.cs', mode: 'code'}]);
  commands.dispose();
  assert.equal(registry.list().length, 0);
});

test('F7 only handles an enabled view command and preserves unrelated keyboard events', async () => {
  const registry = createCommandRegistry();
  const calls = [];
  const documents = {state: {active: 'View.cs'}, get: () => null, probe: () => ({compatible: true}),
    open: async (uri, mode) => calls.push({uri, mode})};
  const commands = contributeDesignerCommands(registry, {documents});
  const event = {key: 'F7', shiftKey: true, preventDefault() { this.prevented = true; }, stopPropagation() {}};
  assert.equal(commands.keydown(event), true);
  assert.equal(event.prevented, true);
  await Promise.resolve();
  assert.deepEqual(calls, [{uri: 'View.cs', mode: 'design'}]);
  assert.equal(commands.keydown({...event, ctrlKey: true}), false);
  assert.equal(commands.keydown({...event, defaultPrevented: true}), false);
  commands.dispose();
});
