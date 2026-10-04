import { WinUIHost } from '@sharpforge/winui';
import { element, actionButton, selectField, replaceOptions } from './session-dom.js';
import { workbenchError } from './state-events.js';

class VisualTreeInspector {
  constructor(owner) {
    this.owner = owner;
    this.scene = null;
    this.selectedVisual = null;
    this.epoch = 0;
    this.controller = null;
    this.refreshQueued = false;
    this.disposed = false;
  }

  clear() {
    this.epoch++;
    this.controller?.abort('Application inspection changed');
    this.controller = null;
    this.scene = null;
    this.selectedVisual = null;
  }

  async refresh() {
    if (this.disposed) return null;
    this.controller?.abort('Application inspection superseded');
    const target = this.capture();
    if (!target) {
      this.clear();
      this.renderVisual(this.owner.docking.content.get('visual-tree'));
      return null;
    }
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const scene = await target.request(controller.signal);
      if (this.disposed || controller.signal.aborted || epoch !== this.epoch || !target.current()) return null;
      this.scene = scene;
      if (!scene?.nodes?.some(node => node.id === this.selectedVisual)) this.selectedVisual = null;
      this.renderVisual(this.owner.docking.content.get('visual-tree'));
      return scene;
    } catch (error) {
      if (controller.signal.aborted || this.disposed || epoch !== this.epoch || !target.current()) return null;
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  queueRefresh() {
    if (this.disposed || this.refreshQueued || this.owner.state.panel !== 'visual-tree') return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (!this.disposed && this.owner.state.panel === 'visual-tree') this.owner.run(() => this.refresh());
    });
  }

  renderVisual(root) {
    if (!root) return;
    const document = root.ownerDocument;
    const tools = element(document, 'div', null, { class: 'panel-tools' });
    const count = this.scene?.nodes?.length ?? 0;
    tools.append(element(document, 'b', 'Live Visual Tree'),
      actionButton(document, 'Refresh', () => this.refresh(), error => this.owner.error(error)),
      element(document, 'span', `${count} managed objects`));
    const split = element(document, 'div', null, { class: 'advanced-split' });
    const nodes = element(document, 'div', null, { class: 'advanced-visual-nodes' });
    const properties = element(document, 'pre', null, { class: 'advanced-visual-properties' });
    const describe = () => {
      properties.textContent = JSON.stringify(this.scene?.nodes.find(node => node.id === this.selectedVisual) ?? {
        info: 'Select an object. Property values are a live managed snapshot.'
      }, null, 2);
    };
    for (const node of this.scene?.nodes ?? []) {
      const button = element(document, 'button', null, { type: 'button', 'data-visual': node.id });
      button.classList.toggle('selected', node.id === this.selectedVisual);
      button.append(element(document, 'span', node.type.split('.').at(-1)),
        element(document, 'b', node.properties.Name ?? ''), element(document, 'small', node.id));
      button.addEventListener('click', () => {
        this.selectedVisual = node.id;
        for (const item of nodes.children) item.classList.toggle('selected', item === button);
        describe();
      });
      nodes.append(button);
    }
    describe();
    split.append(nodes, properties);
    root.replaceChildren(tools, split);
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }
}

/** Borrows the active application's existing host; it never creates, moves or disposes that host. */
export class ActiveApplicationInspector extends VisualTreeInspector {
  constructor(owner) {
    super(owner);
    if (typeof owner.getApplicationWindows !== 'function') throw new TypeError('Application window lookup is required');
    this.sessions = owner.sessions;
    this.emptyMetrics = new Map();
    this.selectedSession = this.sessions.active;
    this.identity = this.selectedSession?.identity ?? null;
    this.unsubscribe = this.sessions.subscribe(event => this.receive(event));
  }

  panelFor(session) { return session ? this.owner.getApplicationWindows()?.panels.get(session.id) ?? null : null; }
  get panel() { return this.disposed ? null : this.panelFor(this.sessions.active); }
  get host() { return this.panel?.host ?? null; }
  get status() { return this.panel?.status ?? null; }
  get metrics() { return this.panel?.measured ?? this.emptyMetrics; }
  get renderer() { return this.sessions.active?.renderer ?? 'auto'; }

  set renderer(value) {
    const host = this.ensure();
    host.setBackend(value);
    this.sessions.active.renderer = value;
    const select = this.panel.element.querySelector('select[aria-label="Application renderer"]');
    if (select) select.value = value;
  }

  ensure() {
    const host = this.host;
    if (!host) throw workbenchError('APP_WINDOW_UNAVAILABLE', 'Select a running WinUI application first');
    return host;
  }

  capture() {
    const session = this.sessions.active;
    if (!session?.debug || session.disposed || !session.live) return null;
    const identity = session.identity;
    return {
      current: () => this.sessions.active === session && !session.disposed && session.identity === identity,
      request: signal => session.request('uiScene', { identity }, { signal })
    };
  }

  synchronizeSelection() {
    const session = this.sessions.active;
    const identity = session?.identity ?? null;
    if (session === this.selectedSession && identity === this.identity) return false;
    this.selectedSession = session;
    this.identity = identity;
    this.clear();
    this.renderVisual(this.owner.docking.content.get('visual-tree'));
    this.queueRefresh();
    return true;
  }

  receive(event) {
    if (this.disposed || !['selected', 'state', 'ui', 'started', 'ended', 'removed'].includes(event.type)) return;
    this.synchronizeSelection();
    if (event.type === 'state' && event.session) this.updateStatus(event.session);
    if (event.appId !== this.sessions.activeId) return;
    if (event.type === 'ui') this.onUI(event.commands);
    if (event.type === 'ended') {
      this.clear();
      this.renderVisual(this.owner.docking.content.get('visual-tree'));
    }
    if (event.type === 'selected' && this.owner.state.panel === 'winui') this.renderApplication(this.owner.docking.content.get('winui'));
  }

  updateStatus(session) {
    const panel = this.panelFor(session);
    panel?.host.root.classList.toggle('debug-paused', session.state === 'paused');
  }

  onState() {
    this.synchronizeSelection();
    if (this.sessions.active) this.updateStatus(this.sessions.active);
  }

  onUI(commands = []) {
    if (commands.some(command => command.op === 'reset')) this.clear();
    this.queueRefresh();
  }

  renderApplication(root) {
    if (!root) return;
    const document = root.ownerDocument;
    const panel = this.panel;
    const tools = element(document, 'div', null, { class: 'panel-tools' });
    tools.append(element(document, 'b', this.sessions.active?.name ?? 'WinUI Application'));
    if (panel) tools.append(actionButton(document, 'Open application',
      () => this.owner.docking.activate(panel.id), error => this.owner.error(error)));
    tools.append(actionButton(document, 'Live Visual Tree',
      () => this.owner.docking.activate('visual-tree'), error => this.owner.error(error)));
    root.replaceChildren(tools, element(document, 'p', panel ? 'The selected application has its own document window.' :
      'Start or select a WinUI application to inspect its window.', { class: 'advanced-note' }));
    if (panel && this.owner.state.panel === 'winui') this.owner.docking.activate(panel.id);
  }

  dispose() {
    this.unsubscribe();
    super.dispose();
  }
}

/** The standalone embedding retains one owned host only when no SessionManager is supplied. */
export class LegacyApplicationInspector extends VisualTreeInspector {
  constructor(owner) {
    super(owner);
    this.host = null;
    this.status = null;
    this.metrics = new Map();
    this.renderer = 'auto';
    this.identity = null;
  }

  ensure() {
    if (this.disposed) throw workbenchError('APP_INSPECTOR_DISPOSED', 'Application inspector is disposed');
    if (this.host) return this.host;
    const root = this.owner.docking.content.get('winui');
    const document = root.ownerDocument;
    root.classList.add('sf-app-tool');
    const tools = element(document, 'div', null, { class: 'panel-tools' });
    const renderer = selectField(document, 'Application renderer');
    renderer.select.id = 'winui-renderer';
    replaceOptions(renderer.select, ['auto', 'webgpu', 'canvas2d', 'dom'].map(value => ({ value, label: value })), this.renderer);
    tools.append(element(document, 'b', 'WinUI Application'), renderer.wrapper,
      actionButton(document, 'Live Visual Tree', () => this.owner.docking.activate('visual-tree'), error => this.owner.error(error)),
      actionButton(document, 'Stop', () => this.owner.request('stop'), error => this.owner.error(error)));
    this.status = element(document, 'div', null, { class: 'winui-app-status', role: 'status' });
    const content = element(document, 'div', null, { class: 'winui-app-root' });
    const metrics = element(document, 'div', null, { class: 'winui-renderer-status' });
    root.replaceChildren(tools, this.status, content, metrics);
    this.host = new WinUIHost(content, {
      backend: this.renderer,
      onEvent: (id, event, payload) => this.owner.run(() => this.owner.request('uiEvent', { id, event, payload })),
      onLayout: changes => {
        if (this.owner.state.debug && this.owner.state.debug.state !== 'paused') {
          this.owner.run(() => this.owner.request('uiLayout', { changes }));
        }
      },
      onMetrics: value => {
        this.metrics.set(value.id, value);
        metrics.textContent = [...this.metrics.values()].map(item =>
          `${item.backend} · ${item.primitives} primitives · ${Number(item.submitMs ?? 0).toFixed(2)} ms`).join(' | ');
      },
      onError: error => this.owner.error(error)
    });
    renderer.select.addEventListener('change', () => {
      this.host.setBackend(renderer.select.value);
      this.renderer = renderer.select.value;
    });
    return this.host;
  }

  capture() {
    const identity = this.owner.state.debug?.sessionId;
    if (identity === undefined || identity === null) return null;
    return {
      current: () => this.owner.state.debug?.sessionId === identity,
      request: signal => this.owner.request('uiScene', { sessionId: identity }, { signal })
    };
  }

  onState(state) {
    if (this.identity !== state.sessionId) {
      this.identity = state.sessionId;
      this.clear();
      this.queueRefresh();
    }
    this.host?.root.classList.toggle('debug-paused', state.state === 'paused');
    if (this.status) this.status.textContent = state.state === 'paused' ? 'Paused — Continue to interact' :
      state.uiActive ? 'Application running · managed callbacks' : 'No active application';
  }

  onUI(commands) {
    this.ensure().apply(commands);
    if (commands.some(command => command.op === 'activate')) this.owner.docking.activate('winui');
    if (commands.some(command => command.op === 'reset')) this.metrics.clear();
    this.queueRefresh();
  }

  renderApplication() { this.ensure(); }
  dispose() {
    super.dispose();
    this.host?.dispose();
    this.host = null;
    this.metrics.clear();
  }
}

/** Existing debugger and automation methods delegate to the explicitly selected application adapter. */
export class ApplicationInspectorHost {
  constructor(services) {
    Object.assign(this, services);
    this.applicationInspector = this.sessions ? new ActiveApplicationInspector(this) : new LegacyApplicationInspector(this);
  }

  get appHost() { return this.applicationInspector.host; }
  get appRoot() { return this.appHost?.root ?? null; }
  get appStatus() { return this.applicationInspector.status; }
  get metrics() { return this.applicationInspector.metrics; }
  get renderer() { return this.applicationInspector.renderer; }
  set renderer(value) { this.applicationInspector.renderer = value; }
  get scene() { return this.applicationInspector.scene; }
  get selectedVisual() { return this.applicationInspector.selectedVisual; }
  ensureApp() { return this.applicationInspector.ensure(); }
  onUI(commands) { return this.applicationInspector.onUI(commands); }
  refreshVisual() { return this.applicationInspector.refresh(); }
  renderVisual(root) { return this.applicationInspector.renderVisual(root); }
  renderApplication(root) { return this.applicationInspector.renderApplication(root); }
  dispose() { this.applicationInspector.dispose(); }
}
