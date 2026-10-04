import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { contributeDesignerCommands } from '../apps/studio/designer-commands.js';

test('designer command permission follows the explicit invocation URI before the active document', async () => {
  const registry = createCommandRegistry();
  const calls = [];
  let active = 'Unsupported.cs';
  const documents = {
    state: {active}, get: () => null,
    probe: uri => ({compatible: ['View.cs', 'Drawing.sfdesign.json'].includes(uri)}),
    open: async (uri, mode) => { calls.push({uri, mode}); return uri; }
  };
  const contribution = contributeDesignerCommands(registry, {documents, getActiveUri: () => active});
  assert.equal(registry.canExecute('viewDesigner'), false);
  assert.equal(registry.canExecute('viewDesigner', 'View.cs'), true);
  assert.equal(registry.describe('viewDesigner', {args: ['View.cs']}).enabled, true);
  assert.equal(await registry.execute('viewDesigner', 'View.cs'), 'View.cs');
  active = 'View.cs';
  assert.equal(registry.canExecute('viewDesigner', 'Unsupported.cs'), false);
  await assert.rejects(registry.execute('viewDesigner', 'Unsupported.cs'), {
    message: 'Command is unavailable: View Designer'
  });
  assert.equal(registry.canExecute('viewCode', 'Drawing.sfdesign.json'), false);
  await assert.rejects(registry.invoke('viewCode', {args: ['Drawing.sfdesign.json']}), {
    message: 'Command is unavailable: View Code'
  });
  assert.equal(await registry.invoke('openWithDesigner', {args: ['Drawing.sfdesign.json']}), 'Drawing.sfdesign.json');
  assert.deepEqual(calls, [{uri: 'View.cs', mode: 'design'}, {uri: 'Drawing.sfdesign.json', mode: 'design'}]);
  contribution.dispose();
  assert.equal(registry.canExecute('viewDesigner', 'View.cs'), false);
  registry.dispose();
});

test('canExecute shares upstream context, invocation arguments, configured reasons and disposal', async () => {
  let readOnly = true;
  const registry = createCommandRegistry({context: () => ({readOnly, documentUri: 'View.cs'})});
  const calls = [];
  registry.registerCommand('edit', 'Edit', '', (id, uri) => calls.push({id, uri}), {
    enabled: context => !context.readOnly && context.args?.[0] === context.documentUri || 'Select an editable document'
  });
  assert.equal(registry.canExecute('edit', 'View.cs'), false);
  await assert.rejects(registry.execute('edit', 'View.cs'), {message: 'Select an editable document'});
  readOnly = false;
  assert.equal(registry.canExecute('edit', 'Other.cs'), false);
  assert.equal(registry.canExecute('edit', 'View.cs'), true);
  await registry.execute('edit', 'View.cs');
  const restore = registry.configure('edit', {enabled: () => 'Build is running'});
  assert.equal(registry.canExecute('edit', 'View.cs'), false);
  await assert.rejects(registry.execute('edit', 'View.cs'), {message: 'Build is running'});
  restore();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registry.invoke('edit', {args: ['View.cs'], signal: controller.signal}), {name: 'AbortError'});
  assert.deepEqual(calls, [{id: 'edit', uri: 'View.cs'}]);
  registry.dispose();
  assert.equal(registry.canExecute('edit', 'View.cs'), false);
  await assert.rejects(registry.execute('edit', 'View.cs'), /disposed/);
});
