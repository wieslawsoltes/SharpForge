import {WinUIHost} from '../../packages/winui/src/index.js';
import {TreeModel, TreeView} from '../../packages/controls/src/index.js';
import {appRuntimeTree, appWindowDescriptors} from './designer-app-host-tree.js';
import {releaseAppResources} from './designer-app-host-errors.js';

function element(document, tag, className, text) {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

/** Modeless, independent WinUI window. It sends input only through the supplied app callbacks. */
export class DesignerAppWindow {
  constructor({document = globalThis.document, container = document?.body, identity, projectName, position = 0,
    backend = 'auto', onEvent, onLayout, onSelect, onFront, onError, controls} = {}) {
    if (!document?.createElement || !container) throw new TypeError('An app window needs a DOM document and container');
    Object.assign(this, {document, container, identity, onSelect, onFront, onError, controls, projectName});
    this.disposed = false;
    this.inspect = false;
    this.selected = [];
    this.listeners = [];
    this.state = {state: 'starting', uiActive: false};
    this.element = element(document, 'dialog', 'designer-app-host');
    this.element.dataset.appSession = String(identity.sessionId);
    this.element.dataset.appGeneration = String(identity.generation);
    this.element.setAttribute('aria-modal', 'false');
    this.element.setAttribute('aria-label', `${projectName} application`);
    this.element.style.left = `${32 + position % 8 * 26}px`;
    this.element.style.top = `${52 + position % 8 * 26}px`;
    this.build();
    try {
      this.host = new WinUIHost(this.viewport, {backend, onEvent,
        onLayout: changes => { this.highlight(); onLayout?.(changes); }, onError,
        onMetrics: metrics => this.metrics.textContent = `${metrics.backend} · ${metrics.primitives ?? 0} primitives`});
      this.treeModel = new TreeModel([], {maxNodes: 20_000, maxDepth: 128});
      this.tree = new TreeView(this.treeRoot, {model: this.treeModel, label: `${projectName} runtime visual tree`,
        onSelect: nodes => this.select(nodes.map(node => node.runtimeId), {notify: true}), onError});
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.listen(this.element, 'pointerdown', () => this.onFront?.());
    this.listen(this.element, 'focusin', () => this.onFront?.());
    this.listen(this.element, 'cancel', event => event.preventDefault());
    this.listen(this.element, 'keydown', event => this.controlKey(event));
    this.listen(this.viewport, 'click', event => this.inspectClick(event), true);
    this.listen(this.moveHandle, 'pointerdown', event => this.startMove(event));
    this.listen(this.moveHandle, 'pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(this.moveHandle, type, () => this.endMove());
    this.listen(this.moveHandle, 'keydown', event => this.moveByKey(event));
    this.container.append(this.element);
  }

  build() {
    const document = this.document;
    const toolbar = element(document, 'div', 'designer-app-host-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Application controls');
    this.moveHandle = element(document, 'span', 'designer-app-host-title', this.projectName);
    this.moveHandle.tabIndex = 0;
    this.moveHandle.setAttribute('aria-label', `${this.projectName}. Arrow keys move this application window.`);
    toolbar.append(this.moveHandle);
    this.buttons = new Map();
    for (const [action, label] of [['pause', 'Pause'], ['resume', 'Continue'], ['restart', 'Restart'], ['stop', 'Stop']]) {
      const button = this.button(action, label, () => this.run(action));
      this.buttons.set(action, button);
      toolbar.append(button);
    }
    this.body = element(document, 'div', 'designer-app-host-body');
    this.viewport = element(document, 'div', 'designer-app-host-viewport');
    this.viewport.setAttribute('aria-label', 'Running managed application');
    this.sidebar = element(document, 'aside', 'designer-app-host-inspector');
    this.sidebar.hidden = true;
    const search = element(document, 'input', 'designer-app-host-search');
    search.type = 'search';
    search.placeholder = 'Search runtime tree';
    search.setAttribute('aria-label', 'Search this app runtime tree');
    this.listen(search, 'input', () => this.treeModel.setFilter(search.value));
    this.treeRoot = element(document, 'div', 'designer-app-host-tree');
    this.properties = element(document, 'pre', 'designer-app-host-properties');
    this.sidebar.append(search, this.treeRoot, this.properties);
    this.body.append(this.viewport, this.sidebar);
    const tools = element(document, 'div', 'designer-app-host-tools');
    this.treeButton = this.button('tree', 'Live tree', () => this.toggleTree());
    this.treeButton.setAttribute('aria-expanded', 'false');
    this.inspectButton = this.button('inspect', 'Inspect app', () => this.toggleInspect());
    this.inspectButton.setAttribute('aria-pressed', 'false');
    this.status = element(document, 'span', 'designer-app-host-state', 'Starting');
    this.status.setAttribute('role', 'status');
    this.metrics = element(document, 'span', 'designer-app-host-metrics');
    tools.append(this.treeButton, this.inspectButton, this.status, this.metrics);
    this.output = element(document, 'pre', 'designer-app-host-output');
    this.output.setAttribute('aria-label', 'Application output');
    this.output.hidden = true;
    this.element.append(toolbar, this.body, tools, this.output);
  }

  button(action, label, listener) {
    const button = element(this.document, 'button', 'designer-app-host-button', label);
    button.type = 'button';
    button.dataset.appAction = action;
    this.listen(button, 'click', listener);
    return button;
  }

  listen(target, type, listener, capture = false) {
    target.addEventListener(type, listener, capture);
    this.listeners.push(() => target.removeEventListener(type, listener, capture));
  }

  show() {
    if (this.disposed) return;
    if (!this.element.open) this.element.show();
    const rect = this.element.getBoundingClientRect();
    this.position(rect.left, rect.top);
    this.host.schedule();
    this.moveHandle.focus({preventScroll: true});
  }

  async run(action) {
    this.setBusy(true);
    try {
      await this.controls[action]();
    } catch (error) {
      if (!this.disposed) this.error(error);
    } finally {
      if (!this.disposed) this.setBusy(false);
    }
  }

  controlKey(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || !['F5', 'F6'].includes(event.key)) return;
    const action = event.key === 'F6' ? 'pause' : event.shiftKey ? 'stop' : event.ctrlKey || event.metaKey ? 'restart' : 'resume';
    event.preventDefault();
    event.stopPropagation();
    const button = this.buttons.get(action);
    if (!button.disabled) button.click();
  }

  apply(commands) {
    if (this.disposed) return;
    this.host.apply(commands);
    if (commands.some(command => ['create', 'reset', 'activate', 'close', 'collection'].includes(command.op) ||
        command.op === 'set' && ['Content', 'Child', 'Name', 'Title'].includes(command.property))) this.refreshTree();
    this.highlight();
  }

  refreshTree() {
    this.treeModel.setNodes(appRuntimeTree(this.host.nodes, this.host.windows));
    this.select(this.selected);
  }

  windows() { return appWindowDescriptors(this.host.nodes, this.host.windows); }

  setState(state) {
    if (this.disposed) return;
    this.state = state;
    this.element.dataset.appState = state.state;
    this.element.dataset.runtimeState = state.runtimeState ?? state.state;
    this.element.dataset.pauseKind = state.pauseKind ?? '';
    this.viewport.classList.toggle('debug-paused', state.state === 'paused');
    if (state.pauseKind === 'idle-ui') {
      this.status.textContent = state.pauseAcknowledged ? 'UI paused · managed entry point has returned' :
        'UI input paused · animation pause unconfirmed; Continue to restore';
    } else if (state.pauseKind === 'debugger') this.status.textContent = 'Managed execution paused · Continue to interact';
    else this.status.textContent = state.state === 'terminated' && state.uiActive ? 'Idle app · ready for managed input' :
      `${state.state} · generation ${this.identity.generation}`;
    if (typeof state.output === 'string') this.setOutput(state.output);
    this.setBusy(this.busy);
  }

  setBusy(value) {
    this.busy = !!value;
    const state = this.state.state;
    const pausable = ['ready', 'running', 'waiting'].includes(state) || state === 'terminated' && this.state.uiActive;
    this.buttons.get('pause').disabled = this.busy || !pausable;
    this.buttons.get('resume').disabled = this.busy || state !== 'paused';
    this.buttons.get('restart').disabled = this.busy;
  }

  setOutput(value) {
    this.output.textContent = String(value).slice(-65_536);
    this.output.hidden = !this.output.textContent;
  }

  error(error) {
    this.status.textContent = error.message ?? String(error);
    this.onError?.(error);
  }

  toggleTree() {
    this.sidebar.hidden = !this.sidebar.hidden;
    this.treeButton.setAttribute('aria-expanded', String(!this.sidebar.hidden));
    if (!this.sidebar.hidden) {
      this.refreshTree();
      this.tree.focus();
    }
    this.host.schedule();
  }

  toggleInspect() {
    this.inspect = !this.inspect;
    this.inspectButton.setAttribute('aria-pressed', String(this.inspect));
    this.viewport.classList.toggle('designer-app-host-inspecting', this.inspect);
  }

  inspectClick(event) {
    if (!this.inspect) return;
    const id = event.target.closest?.('[data-sf-id]')?.dataset.sfId;
    if (!id || !this.host.nodes.has(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.sidebar.hidden) this.toggleTree();
    this.select([id], {notify: true});
  }

  select(runtimeIds, {notify = false} = {}) {
    if (this.disposed) return;
    this.selected = [...new Set(runtimeIds)].filter(id => this.host.nodes.has(id)).slice(0, 1000);
    this.treeModel.selected = new Set(this.selected.filter(id => this.treeModel.nodes.has(id)));
    if (this.selected[0]) this.treeModel.reveal(this.selected[0], {select: false});
    else this.treeModel.notify();
    const node = this.host.nodes.get(this.selected[0]);
    this.properties.textContent = node ? JSON.stringify(node, null, 2).slice(0, 16_384) : 'Select a runtime visual.';
    this.highlight();
    if (notify) this.onSelect?.(this.selected);
  }

  highlight() {
    const selected = new Set(this.selected);
    for (const [id, node] of this.host.elements) node.classList.toggle('designer-app-host-selected', selected.has(id));
  }

  startMove(event) {
    if (event.button !== 0) return;
    const rect = this.element.getBoundingClientRect();
    this.moving = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
    this.moveHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  position(left, top) {
    const window = this.document.defaultView;
    this.element.style.left = `${Math.max(0, Math.min(left, window.innerWidth - 180))}px`;
    this.element.style.top = `${Math.max(0, Math.min(top, window.innerHeight - 60))}px`;
  }

  move(event) {
    const moving = this.moving;
    if (moving?.pointerId !== event.pointerId) return;
    this.position(moving.left + event.clientX - moving.x, moving.top + event.clientY - moving.y);
  }

  endMove() {
    const pointer = this.moving?.pointerId;
    this.moving = null;
    if (pointer !== undefined && this.moveHandle.hasPointerCapture(pointer)) this.moveHandle.releasePointerCapture(pointer);
  }

  moveByKey(event) {
    const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.element.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 10;
    this.position(rect.left + direction[0] * step, rect.top + direction[1] * step);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    releaseAppResources([
      () => this.endMove(), ...this.listeners.splice(0), () => this.tree?.dispose(), () => this.host?.dispose(),
      () => { if (this.element.open) this.element.close(); }, () => this.element.remove()
    ]);
  }
}
