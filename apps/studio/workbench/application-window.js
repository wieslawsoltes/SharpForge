import { WinUIHost } from '@sharpforge/winui';
import { element, actionButton, selectField, replaceOptions } from './session-dom.js';

/** One retained WinUI host and docking identity per app. No global renderer or scene. */
export class ApplicationWindows {
  constructor({ sessions, document = globalThis.document, registerPanel, unregisterPanel, confirmStop, onError, createHost } = {}) {
    if (!sessions || !document || typeof registerPanel !== 'function') throw new TypeError('Application window host services are required');
    this.sessions = sessions;
    this.document = document;
    this.registerPanel = registerPanel;
    this.unregisterPanel = unregisterPanel;
    this.confirmStop = confirmStop ?? (session => document.defaultView.confirm(`Stop ${session.name} and close its application window?`));
    this.onError = onError ?? (error => { throw error; });
    this.createHost = createHost ?? ((root, options) => new WinUIHost(root, options));
    this.panels = new Map();
    this.unsubscribe = sessions.subscribe(event => this.receive(event));
  }

  ensure(session) {
    const existing = this.panels.get(session.id);
    if (existing) return existing;
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
    const host = this.createHost(content, {
      backend: session.renderer,
      onEvent: (id, event, payload) => session.request('uiEvent', { id, event, payload }).catch(this.onError),
      onLayout: changes => {
        if (session.live && session.state !== 'paused') session.request('uiLayout', { changes }).catch(this.onError);
      },
      onMetrics: value => {
        measured.set(value.id, value);
        metrics.textContent = [...measured.values()].map(item => {
          return `${item.backend} · ${item.primitives} primitives · ${Number(item.submitMs ?? 0).toFixed(2)} ms`;
        }).join(' | ');
      },
      onError: this.onError
    });
    renderer.select.addEventListener('change', () => {
      session.renderer = renderer.select.value;
      host.setBackend(session.renderer);
    });
    const id = `app:${session.id}`;
    const panel = { id, sessionId: session.id, element: root, host, status, measured, disposeRegistration: null };
    this.panels.set(session.id, panel);
    try {
      panel.disposeRegistration = this.registerPanel({
        id, title: session.name, kind: 'document', element: root, onClose: () => this.close(session.id)
      });
    } catch (error) {
      this.panels.delete(session.id);
      host.dispose();
      throw error;
    }
    return panel;
  }

  receive(event) {
    if (event.type === 'ui') {
      const panel = this.ensure(event.session);
      if (event.commands.some(command => command.op === 'reset')) panel.measured.clear();
      panel.host.apply(event.commands);
    }
    const panel = this.panels.get(event.appId);
    if (panel && ['state', 'started', 'ended'].includes(event.type)) {
      const session = event.session;
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
    panel.host.dispose();
    if (typeof panel.disposeRegistration === 'function') panel.disposeRegistration();
    else this.unregisterPanel?.(panel.id);
    panel.element.remove();
  }

  dispose() {
    this.unsubscribe();
    for (const id of [...this.panels.keys()]) this.remove(id);
  }
}
