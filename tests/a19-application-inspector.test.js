import test from 'node:test';
import assert from 'node:assert/strict';
import { WinUIHost } from '@sharpforge/winui';
import { DebuggerExtensions } from '../apps/studio/debugger-extensions.js';
import { ActiveApplicationInspector, LegacyApplicationInspector } from '../apps/studio/workbench/application-inspector.js';
import { createAutomationApi } from '../apps/studio/automation-api.js';
import { contributeDebuggerAutomation } from '../apps/studio/tools/debugger-automation.js';
import { createInspectorFixture, inspectorDocument, visualScene } from './support/a19-inspector-fixture.js';
import { settle } from './a19-session-fixtures.js';

test('legacy renderer, metrics and settling automation borrows only the active application host', async context => {
  const fixture = await createInspectorFixture(context);
  const { inspector, sessions, alpha, beta, panels } = fixture;
  const automation = createAutomationApi();
  context.after(() => automation.dispose());
  contributeDebuggerAutomation(automation, { advancedTools: inspector });
  assert.ok(inspector.applicationInspector instanceof ActiveApplicationInspector);
  assert.equal(inspector.ensureApp(), panels.get(alpha.id).host);
  automation.api.setUIRenderer('webgpu');
  assert.equal(alpha.renderer, 'webgpu');
  assert.equal(panels.get(alpha.id).host.backend, 'webgpu');
  assert.equal(panels.get(alpha.id).element.querySelector('select[aria-label="Application renderer"]').value, 'webgpu');
  assert.equal(beta.renderer, 'canvas2d');
  assert.equal(await automation.api.uiSettled(), alpha.id);
  assert.deepEqual(automation.api.getUIMetrics(), [...panels.get(alpha.id).measured.values()]);
  sessions.setActive(beta.id);
  assert.equal(inspector.appHost, panels.get(beta.id).host);
  assert.equal(await automation.api.uiSettled(), beta.id);
  assert.deepEqual(automation.api.getUIMetrics(), [...panels.get(beta.id).measured.values()]);
  assert.throws(() => automation.api.setUIRenderer('unsupported'), /Unknown renderer/);
  assert.equal(beta.renderer, 'canvas2d');
  assert.equal(fixture.docking.content.get('winui').children.length, 0, 'No obsolete host or controls should be constructed');
});

test('scene responses cannot cross selected sessions with equal runtime serials or matching node IDs', async context => {
  const fixture = await createInspectorFixture(context, { visual: true });
  const { inspector, sessions, alpha, beta, requests } = fixture;
  assert.equal(alpha.runtimeSession, beta.runtimeSession);
  const stale = inspector.refreshVisual();
  await settle();
  assert.equal(requests.length, 1);
  sessions.setActive(beta.id);
  assert.equal(inspector.scene, null);
  const current = inspector.refreshVisual();
  await settle();
  requests[1].reply.resolve(visualScene('Beta'));
  assert.deepEqual(await current, visualScene('Beta'));
  requests[0].reply.resolve(visualScene('Alpha'));
  assert.equal(await stale, null);
  assert.deepEqual(inspector.scene, visualScene('Beta'));
  assert.deepEqual(fixture.errors, []);
});

test('active worker restart invalidates pending visual inspection even when its runtime serial repeats', async context => {
  const fixture = await createInspectorFixture(context);
  const pending = fixture.inspector.refreshVisual();
  await settle();
  const identity = fixture.alpha.identity;
  await fixture.alpha.restart();
  assert.notEqual(fixture.alpha.identity, identity);
  assert.equal(fixture.alpha.runtimeSession, 1);
  fixture.requests[0].reply.resolve(visualScene('old generation'));
  assert.equal(await pending, null);
  assert.equal(fixture.inspector.scene, null);
  assert.deepEqual(fixture.errors, []);
});

test('background UI never changes the selected host and active inspection never reapplies scene commands', async context => {
  const fixture = await createInspectorFixture(context);
  const { inspector, sessions, alpha, beta, panels } = fixture;
  beta.emit('ui', { commands: [{ op: 'reset', snapshot: visualScene('Beta') }] });
  assert.equal(sessions.active, alpha);
  assert.equal(inspector.appHost, panels.get(alpha.id).host);
  alpha.emit('ui', { commands: [{ op: 'reset', snapshot: visualScene('Alpha') }] });
  assert.equal(panels.get(alpha.id).host.applyCount, 0);
  assert.equal(panels.get(beta.id).host.applyCount, 0);
  inspector.renderApplication(fixture.docking.content.get('winui'));
  assert.equal(fixture.docking.active, null, 'Background tool refresh cannot change document focus');
  fixture.state.panel = 'winui';
  inspector.renderApplication(fixture.docking.content.get('winui'));
  assert.equal(fixture.docking.active, panels.get(alpha.id).id);
});

test('stopping or removing the selected app clears visual state and reports a missing window explicitly', async context => {
  const fixture = await createInspectorFixture(context, { visual: true });
  const pending = fixture.inspector.refreshVisual();
  await settle();
  fixture.requests[0].reply.resolve(visualScene('Alpha'));
  await pending;
  await fixture.alpha.stop();
  assert.equal(fixture.inspector.scene, null);
  fixture.panels.delete(fixture.alpha.id);
  fixture.sessions.remove(fixture.alpha.id);
  assert.equal(fixture.inspector.appHost, null);
  assert.equal(fixture.inspector.metrics.size, 0);
  assert.throws(() => fixture.inspector.ensureApp(), { code: 'APP_WINDOW_UNAVAILABLE' });
});

test('disposing inspection aborts pending queries and releases subscriptions without disposing application windows', async context => {
  const fixture = await createInspectorFixture(context);
  const pending = fixture.inspector.refreshVisual();
  await settle();
  const listeners = fixture.sessions.events.listeners.size;
  fixture.inspector.dispose();
  assert.equal(fixture.sessions.events.listeners.size, listeners - 1);
  fixture.requests[0].reply.resolve(visualScene('disposed'));
  assert.equal(await pending, null);
  fixture.sessions.setActive(fixture.beta.id);
  assert.equal(fixture.inspector.appHost, null);
  assert.equal(fixture.inspector.scene, null);
  for (const panel of fixture.panels.values()) assert.equal(panel.host.disposed, false);
});

test('standalone construction without a SessionManager retains one owned WinUI host', () => {
  const document = inspectorDocument();
  const root = document.createElement('section');
  const inspector = new DebuggerExtensions({ state: { panel: 'output' },
    docking: { content: new Map([['winui', root]]), activate() {} }, toast: error => { throw new Error(error); } });
  assert.ok(inspector.applicationInspector instanceof LegacyApplicationInspector);
  assert.equal(inspector.appHost, null);
  const host = inspector.ensureApp();
  assert.ok(host instanceof WinUIHost);
  assert.equal(inspector.ensureApp(), host);
  inspector.onUI([{ op: 'create', id: 'standalone', type: 'Microsoft.UI.Xaml.Controls.TextBlock', properties: { Text: 'standalone' } }]);
  assert.equal(host.nodes.get('standalone').properties.Text, 'standalone');
  inspector.dispose();
  assert.equal(host.disposed, true);
});
