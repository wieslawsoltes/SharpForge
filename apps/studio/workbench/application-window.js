import {StudioUIHostBridge} from '../ui-host-bridge.js';
import { element, actionButton, selectField, replaceOptions } from './session-dom.js';

/** One retained WinUI host and docking identity per app. No global renderer or scene. */
export class ApplicationWindows {
  constructor({ sessions, document = globalThis.document, registerPanel, unregisterPanel, confirmStop, onError, createHost,
    hostCapabilities = {}, schedulerOptions = {} } = {}) {
    if (!sessions || !document || typeof registerPanel !== 'function') throw new TypeError('Application window host services are required');
    this.sessions = sessions;
    this.document = document;
    this.registerPanel = registerPanel;
    this.unregisterPanel = unregisterPanel;
    this.confirmStop = confirmStop ?? (session => document.defaultView.confirm(`Stop ${session.name} and close its application window?`));
    this.onError = onError ?? (error => { throw error; });
    this.createHost = createHost;
    this.hostCapabilities = hostCapabilities;
    this.schedulerOptions = schedulerOptions;
    this.panels = new Map();
    this.unsubscribe = sessions.subscribe(event => this.receive(event));
  }

  createBridge(session, root, measured, metrics) {
    const identity = session.identity;
    return new StudioUIHostBridge(root, {
      sessionId: session.runtimeSession ?? 0, createHost: this.createHost, hostCapabilities: this.hostCapabilities,
      paused: session.state === 'paused' || session.state === 'launching' || !session.live,
      schedulerOptions: this.schedulerOptions, onError: this.onError,
      request: (method, payload) => session.request(method, {...payload, identity}),
      hostOptions: {backend: session.renderer, onMetrics: value => {
        measured.set(value.id, value);
        metrics.textContent = [...measured.values()].map(item =>
          `${item.backend} · ${item.primitives} primitives · ${Number(item.submitMs ?? 0).toFixed(2)} ms`).join(' | ');
      }}
    });
  }

  synchronize(panel, session) {
    if (panel.identity !== session.identity) {
      panel.bridge.dispose();
      panel.measured.clear();
      panel.bridge = this.createBridge(session, panel.content, panel.measured, panel.metrics);
      panel.identity = session.identity;
    }
    panel.bridge.setPaused(session.state === 'paused' || session.state === 'launching' || !session.live);
  }

  ensure(session) {
    const existing = this.panels.get(session.id);
    if (existing) { this.synchronize(existing, session); return existing; }
    const document = this.document;
    const root = element(document, 'section', null, { class: 'sf-app-tool', 'data-app-session': session.id });
    const tools = element(document, 'div', null, { class: 'panel-tools' });
    const status = element(document, 'div', 'Application starting', { class: 'winui-app-status', role: 'status' });
    const content = element(document, 'div', null, { class: 'winui-app-root' });
    const metrics = element(document, 'div', '', { class: 'winui-renderer-status' });
    const renderer = selectField(document, 'Application renderer');
    replaceOptions(renderer.select, ['auto', 'webgpu', 'canvas2d', 'dom'].map(value => ({ value, label: value })), session.renderer);
    tools.append(element(document, 'b', session.name), renderer.wrapper,
      actionButton(document, 'Stop', () => session.stop(), this.onError));
    root.append(tools, status, content, metrics);
    const measured = new Map();
    const bridge = this.createBridge(session, content, measured, metrics);
    const id = `app:${session.id}`;
    const panel = {id, sessionId: session.id, identity: session.identity, element: root, content, metrics, bridge,
      get host() { return this.bridge.host; }, status, measured, disposeRegistration: null};
    this.synchronize(panel, session);
    renderer.select.addEventListener('change', () => {
      session.renderer = renderer.select.value;
      panel.bridge.hostOptions.backend = session.renderer;
      panel.host.setBackend(session.renderer);
    });
    this.panels.set(session.id, panel);
    try {
      panel.disposeRegistration = this.registerPanel({
        id, title: session.name, kind: 'document', element: root, onClose: () => this.close(session.id)
      });
    } catch (error) {
      this.panels.delete(session.id);
      bridge.dispose();
      throw error;
    }
    return panel;
  }

  receive(event) {
    if (event.type === 'ui' || event.type === 'uiHost') {
      const panel = this.ensure(event.session);
      if (event.commands?.some(command => command.op === 'reset')) panel.measured.clear();
      panel.bridge.receive(event.event ?? {event: 'ui', sessionId: event.session.runtimeSession ?? 0, commands: event.commands ?? []});
    }
    const panel = this.panels.get(event.appId);
    if (panel && ['state', 'starting', 'started', 'ended'].includes(event.type)) {
      const session = event.session;
      this.synchronize(panel, session);
      if (event.type === 'ended') panel.bridge.cancelPending();
      panel.status.textContent = `${session.name} · ${session.state === 'paused' ? 'Paused' : session.state}`;
      panel.element.classList.toggle('debug-paused', session.state === 'paused');
    }
    if (event.type === 'removed') this.remove(event.appId);
  }

  async close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session?.live && !await this.confirmStop(session)) return false;
    if (session?.live) await session.stop();
    this.remove(sessionId);
    return true;
  }

  remove(sessionId) {
    const panel = this.panels.get(sessionId);
    if (!panel) return;
    this.panels.delete(sessionId);
    panel.bridge.dispose();
    if (typeof panel.disposeRegistration === 'function') panel.disposeRegistration();
    else this.unregisterPanel?.(panel.id);
    panel.element.remove();
  }

  dispose() {
    this.unsubscribe();
    for (const id of [...this.panels.keys()]) this.remove(id);
  }
}
