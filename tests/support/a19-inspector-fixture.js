import { DebuggerExtensions } from '../../apps/studio/debugger-extensions.js';
import { SessionManager } from '../../apps/studio/workbench/session-manager.js';
import { legacyDebug } from '../../apps/studio/workbench/session-compat.js';
import { fakeWorkers, fakeRuntime, deferred } from '../a19-session-fixtures.js';

/** Minimal DOM boundary for inspector unit tests; it does not perform browser layout or painting. */
export function inspectorDocument() {
  const document = { defaultView: { requestAnimationFrame: () => 1, cancelAnimationFrame() {} } };
  document.createElement = tagName => {
    const classes = new Set();
    const node = {
      ownerDocument: document, tagName: tagName.toUpperCase(), children: [], attributes: {}, listeners: new Map(), value: '',
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        toggle(value, force = !classes.has(value)) { if (force) classes.add(value); else classes.delete(value); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      removeEventListener(name) { this.listeners.delete(name); },
      querySelector(selector) {
        const label = selector.match(/^select\[aria-label="([^"]+)"\]$/)?.[1];
        for (const child of this.children) {
          if (label && child.tagName === 'SELECT' && child.attributes['aria-label'] === label) return child;
          const descendant = child.querySelector?.(selector);
          if (descendant) return descendant;
        }
        return null;
      }
    };
    return node;
  };
  return document;
}

function existingPanel(document, session) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Application renderer');
  const element = document.createElement('section');
  element.append(select);
  const host = {
    root: document.createElement('div'), backend: session.renderer, disposed: false, settledCount: 0, applyCount: 0,
    setBackend(value) {
      if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(value)) throw new TypeError('Unknown renderer');
      this.backend = value;
    },
    settled() { this.settledCount++; return Promise.resolve(session.id); },
    apply() { this.applyCount++; },
    dispose() { this.disposed = true; }
  };
  return { id: `app:${session.id}`, sessionId: session.id, host, element, status: document.createElement('div'),
    measured: new Map([['surface', { id: 'surface', backend: session.renderer, primitives: session.id }]]) };
}

/** Real session/worker-client state with controllable scene replies and already-owned renderer boundaries. */
export async function createInspectorFixture(context, { visual = false } = {}) {
  const requests = [];
  const workers = fakeWorkers((message, worker) => {
    if (message.method !== 'uiScene') return fakeRuntime(message, worker);
    const reply = deferred();
    requests.push({ message, worker, reply });
    return reply.promise;
  });
  const sessions = new SessionManager({ workerFactory: workers.factory });
  const alpha = sessions.create({ projectId: 'Alpha', renderer: 'dom' });
  const beta = sessions.create({ projectId: 'Beta', renderer: 'canvas2d' }, { activate: false });
  await alpha.launch({});
  await beta.launch({});
  const document = inspectorDocument();
  const panels = new Map([alpha, beta].map(session => [session.id, existingPanel(document, session)]));
  const docking = { content: new Map([['winui', document.createElement('section')]]), active: null,
    activate(id) { this.active = id; } };
  if (visual) docking.content.set('visual-tree', document.createElement('section'));
  const state = { panel: 'output', get debug() { return legacyDebug(sessions.active); } };
  const errors = [];
  const inspector = new DebuggerExtensions({ state, docking, sessions, getApplicationWindows: () => ({ panels }),
    request() { throw new Error('Active inspector must capture the owning session, not the legacy runtime facade'); },
    toast: error => errors.push(error) });
  context.after(() => { inspector.dispose(); sessions.dispose(); });
  return { inspector, sessions, alpha, beta, panels, docking, state, errors, requests, workers };
}

export function visualScene(name) {
  return { version: 1, windows: [], nodes: [{ id: 'shared-node-id', type: 'Microsoft.UI.Xaml.Controls.TextBlock',
    properties: { Name: name, Text: name }, events: [], collections: {} }] };
}
