import { refreshHostEventListeners } from './event-listeners.js';
import * as controls from './dependencies.js';
import { drawLegacyNode } from './legacy-drawing.js';
import { HostLayoutCommands, publishLayoutFeedback } from './layout-commands.js';
import { applyCollectionChange } from './collection-changes.js';
import { applyDragCommand } from './drag-commands.js';
import { applyAutomationCommand } from './automation-commands.js';
import { reachableNodes, overlayRoots, updateHostLayout } from './root-ownership.js';
import { initializeHostEnvironment, refreshHostEnvironment, disposeHostEnvironment } from './environment.js';
import { handleNativeEvent } from './native-events.js';
import { HostEventRequests } from './event-requests.js';

const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const suffix = type => type.slice(type.lastIndexOf('.') + 1);
const inputUpdates = new Set(['TextChanged', 'PasswordChanged', 'ValueChanged', 'SelectionChanged', 'Checked',
  'Unchecked', 'Toggled', 'Expanding', 'Collapsed', 'DateChanged', 'TimeChanged', 'Opened', 'Closed',
  'PrimaryButtonClick', 'SecondaryButtonClick', 'CloseButtonClick', 'ViewChanged', 'ScrollCompleted', 'ZoomCompleted', 'ModeChanged',
  'PaneOpened', 'PaneClosed', 'DisplayModeChanged', 'ItemExpanding', 'ItemCollapsed', 'ControllerStateChanged',
  'DynamicOverflowItemsChanging']);
const treeProperties = new Set(['Content', 'Child', 'Pane', 'Pane1', 'Pane2']);

/** Retained host: renderer registration, managed layout, input and rendering share one root-owned scene. */
export class RetainedWinUIHost {
  constructor(root, options = {}) {
    if (!root?.ownerDocument) throw new TypeError('WinUIHost requires a DOM root');
    this.root = root;
    this.frameworkType = options.frameworkType ?? (() => null);
    this.drawing = options.drawing;
    const frameworkType = this.frameworkType;
    this.document = root.ownerDocument;
    this.options = { backend: 'auto', onEvent: () => {}, onLayout: () => {}, onMetrics: () => {},
      onError: () => {}, gpu: globalThis.navigator?.gpu, ...options };
    this.services = options.services ?? {};
    this.externalOverlays = this.services.overlays;
    this.nodes = new Map();
    this.parents = new Map();
    this.elements = new Map();
    this.windows = [];
    this.surfaces = new Map();
    this.listeners = new Map();
    this.layouts = new Map();
    this.states = new Map();
    this.privateValues = new Map();
    this.worldLayout = new Map();
    this.pendingFlyouts = [];
    this.openFlyouts = new Map();
    this.backend = this.options.backend;
    this.disposed = false;
    this.frame = 0;
    this.modelDirty = true;
    this.rendering = false;
    this.rootKey = controls.allocateRootId(root, options.rootId);
    root.dataset.sfRoot = this.rootKey;
    this.registry = options.registry?.clone({ resolveType: frameworkType })
      ?? new controls.RendererRegistry({ resolveType: frameworkType });
    if (!options.registry) {
      controls.registerLegacyRenderers(this.registry);
      controls.registerControlFamilies?.(this.registry);
    }
    options.configureRegistry?.(this.registry);
    this.measureProvider = options.measureProvider ?? new controls.MeasureProvider({ document: this.document,
      resolve: id => this.nodes.get(id), textScale: this.services.textScale?.factor ?? 1 });
    this.layoutEngine = new controls.LayoutEngine({ registry: options.layoutRegistry
      ?? controls.createLayoutRegistry({ resolveType: frameworkType }), measureProvider: this.measureProvider,
      resolveChildren: node => this.visualChildren(node), scale: this.document.defaultView.devicePixelRatio || 1 });
    this.context = this.createContext();
    this.eventRequests = new HostEventRequests(this);
    this.composition = new controls.HostComposition(this);
    this.input = new controls.InputManager(this);
    this.eventRouter = this.input.router;
    this.focusManager = this.input.focus;
    this.layoutOperations = controls.createLayoutOperations(this);
    this.layoutCommands = new HostLayoutCommands(this);
    this.automation = options.automation === false ? null : options.automation ?? this.services.automation ?? new controls.AutomationTree(this);
    root.classList.add('sf-winui');
    root.setAttribute('data-theme', 'dark');
    root.tabIndex = -1;
    this.scheduler = options.scheduler ?? this.services.scheduler;
    this.unregisterFrame = this.scheduler?.register('layout', this.rootKey, () => this.render());
    this.unregisterRenderFrame = this.scheduler?.register('build', this.rootKey + ':render', () => {
      if (this.renderOnlyDirty) this.renderOnly();
    });
    this.refreshEventListeners();
    initializeHostEnvironment(this);
  }

  createContext() {
    return { host: this, document: this.document, root: this.root, nodes: this.nodes, elements: this.elements,
      services: this.services, color: this.drawing?.cssColor ?? String, resolve: id => this.nodes.get(id),
      children: (node, property) => this.children(node, property), content: (parent, value) => this.content(parent, value),
      ordered: (parent, children) => this.ordered(parent, children), emit: (node, event, payload) => this.emit(node, event, payload),
      requestEvent: (node, event, payload, options) => this.requestEvent(typeof node === 'string' ? node : node.id, event, payload, options),
      invalidate: (id, kind) => this.invalidate(id, kind), getState: (node, factory = () => ({})) => {
        const id = typeof node === 'string' ? node : node.id;
        if (!this.states.has(id)) this.states.set(id, factory());
        return this.states.get(id);
      }, privateInput: (node, property, value) => this.options.onPrivateInput?.(node.id, property, value) };
  }

  setBackend(backend) {
    if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(backend)) throw new TypeError('Unknown renderer');
    if (this.backend === backend) return;
    this.backend = backend;
    for (const surface of this.surfaces.values()) surface.dispose();
    this.surfaces.clear();
    this.schedule();
  }

  apply(commands) {
    if (!Array.isArray(commands)) commands = [commands];
    if (commands.length > 20000) throw new RangeError('UI command batch limit');
    for (const command of commands) {
      if (!command || typeof command.op !== 'string') throw new TypeError('Invalid UI command');
      const node = this.nodes.get(command.id);
      const extension = this.options.commandHandlers?.get(command.op);
      if (extension) { extension(this.context, command, node); continue; }
      if (applyAutomationCommand(this, command) || applyDragCommand(this, command)) continue;
      if (command.op === 'reset') { this.load(command.snapshot); continue; }
      if (command.op === 'create') this.importNode({ id: command.id, type: command.type, properties: command.properties });
      else if (command.op === 'set' && node) {
        if (command.property === 'Password') this.setPrivateValue(node.id, command.property, command.value);
        else node.properties[command.property] = command.value;
        this.input.visualStates.propertyChanged(node.id, command.property);
        this.invalidate(node.id);
      } else if (command.op === 'event' && node) {
        const events = new Set(node.events);
        if (command.enabled) events.add(command.event);
        else events.delete(command.event);
        node.events = [...events];
      } else if (command.op === 'collection' && node) {
        node.collections[command.property] = [...command.items];
        this.invalidate(node.id);
      } else if (command.op === 'collectionChange' && node) {
        applyCollectionChange(node, command.property, command.change);
        this.invalidate(node.id);
      } else if (command.op === 'draw' && node) node.drawing = command.commands;
      else if (command.op === 'activate') {
        if (command.snapshot) this.merge(command.snapshot);
        if (!this.windows.includes(command.id)) this.windows.push(command.id);
      } else if (command.op === 'close') this.windows = this.windows.filter(id => id !== command.id);
      else if (command.op === 'focus') queueMicrotask(() => this.focusManager.focus(command.id));
      else if (command.op === 'flyout') this.pendingFlyouts.push(command);
      else if (command.op === 'layout') this.layoutCommands.enqueue(command);
      else if (command.op === 'template' && node) { node.templateRoot = command.root; this.invalidate(node.id); }
      else if (command.op === 'templateOwner' && node) node.templateOwner = command.owner;
      else if (command.op === 'remove') {
        this.removeElement(command.id);
        this.eventRouter.removeNode(command.id);
        this.input.dragDrop.removeNode(command.id);
        this.automation?.remove(command.id);
        this.composition.remove(command.id);
        this.nodes.delete(command.id);
        this.services.objectTree?.remove(command.id);
      }
      if (this.nodes.size > 20000) throw new RangeError('WinUI object limit');
    }
    this.modelDirty = true;
    this.schedule();
  }

  importNode(value) {
    if (typeof value.id !== 'string' || !this.frameworkType(value.type)) throw new TypeError('Unknown UI object');
    const properties = { ...value.properties };
    if (Object.hasOwn(properties, 'Password')) {
      this.setPrivateValue(value.id, 'Password', properties.Password);
      delete properties.Password;
    }
    this.nodes.set(value.id, { ...value, properties, events: [...(value.events ?? [])], collections: { ...value.collections } });
  }
  merge(scene) {
    if (scene?.version !== 1 || !Array.isArray(scene.nodes) || !Array.isArray(scene.windows) || scene.nodes.length > 10000) {
      throw new TypeError('Invalid WinUI scene');
    }
    for (const node of scene.nodes) this.importNode(node);
    this.modelDirty = true;
  }
  load(scene) {
    this.eventRequests.clear();
    this.input.dragDrop.reset();
    this.hideFlyouts();
    for (const id of this.nodes.keys()) {
      this.removeElement(id);
      this.eventRouter.removeNode(id);
      this.automation?.remove(id);
      if (this.services.objectTree?.contains(id)) this.services.objectTree.remove(id);
    }
    this.composition.clear();
    this.layoutCommands.clear();
    this.nodes.clear();
    this.windows = [];
    if (scene) { this.merge(scene); this.windows = [...scene.windows]; }
    this.modelDirty = true;
    this.schedule();
  }
  invalidate(id, kind = 'measure') {
    if (kind !== 'render') this.layoutEngine.invalidate(typeof id === 'string' ? id : id.id, kind);
    this.modelDirty = true;
    this.schedule();
  }
  schedule() {
    if (this.disposed || this.frame) return;
    if (this.scheduler) { this.scheduler.invalidate('layout'); return; }
    const window = this.document.defaultView;
    this.frame = (window.requestAnimationFrame?.bind(window) ?? (callback => setTimeout(callback, 16)))(() => {
      this.frame = 0;
      try { if (this.renderOnlyDirty && !this.modelDirty) this.renderOnly(); else this.render(); }
      catch (error) { this.options.onError(error); }
    });
  }
  scheduleRender() {
    this.renderOnlyDirty = true;
    if (this.scheduler) this.scheduler.invalidate('build');
    else this.schedule();
  }
  applyCompositionProperty(id, property, value) { return this.composition.set(id, property, value); }
  getCompositionProperty(id, property) { return this.composition.resolve(id)?.properties[property]; }
  clearCompositionProperty(id, property) { return this.composition.set(id, property, undefined); }
  setElementComposition(id, value) { this.composition.setElement(id, value); }
  setCompositionBrush(id, property, brush) { this.composition.setBrush(id, property, brush); }

  refreshEventListeners() { refreshHostEventListeners(this); }

  create(node) {
    const renderer = this.registry.resolve(node.type);
    const element = renderer?.create?.(this.context, node) ?? this.document.createElement('div');
    if (!element?.ownerDocument) throw new TypeError('Control renderer must create a DOM element');
    element.dataset.sfId = node.id;
    element.dataset.winuiType = suffix(node.type);
    element.classList.add('sf-winui-' + suffix(node.type));
    element.dataset.renderKind = this.renderKind(node);
    this.elements.set(node.id, element);
    this.options.onElementCreated?.(node.id, element);
    const pending = this.privateValues.get(node.id);
    if (pending) {
      for (const [property, value] of pending) renderer?.setPrivateValue?.(this.context, node, element, property, value);
      this.privateValues.delete(node.id);
    }
    return element;
  }
  renderKind(node) {
    return node.type + ':' + !!node.templateRoot + ':' + (this.registry.resolve(node.type)?.renderKey?.(node) ?? '') + ':' + this.registry.version;
  }
  ensure(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    this.renderVisible?.add(id);
    const previous = this.elements.get(id);
    if (previous && previous.dataset.renderKind !== this.renderKind(node)) {
      const focused = previous.contains(this.document.activeElement);
      const selection = { start: previous.selectionStart, end: previous.selectionEnd };
      const renderer = this.registry.resolve(node.type);
      const secret = renderer?.getPrivateValue?.(this.context, node, previous, 'Password');
      this.removeElement(id);
      if (secret !== undefined) this.setPrivateValue(id, 'Password', secret);
      const element = this.create(node);
      if (focused) queueMicrotask(() => {
        if (!this.disposed) { element.focus(); if (selection.start != null) element.setSelectionRange?.(selection.start, selection.end); }
      });
      return element;
    }
    return previous ?? this.create(node);
  }
  setPrivateValue(id, property, value) {
    const node = this.nodes.get(id);
    const element = this.elements.get(id);
    const renderer = node && this.registry.resolve(node.type);
    if (element && renderer?.setPrivateValue) renderer.setPrivateValue(this.context, node, element, property, value);
    else {
      if (!this.privateValues.has(id)) this.privateValues.set(id, new Map());
      this.privateValues.get(id).set(property, value);
    }
  }
  invoke(id, name, args = []) {
    const result = this.layoutOperations.invoke(id, name, args);
    if (result.handled) return result.value;
    const node = this.nodes.get(id);
    const renderer = node && this.registry.resolve(node.type);
    if (renderer?.invoke) return renderer.invoke(this.context, node, this.ensure(id), name, args);
    throw new Error(`Control operation is not implemented: ${name}`);
  }
  ordered(parent, children) {
    let cursor = parent.firstChild;
    for (const child of children) {
      if (child === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(child, cursor);
    }
    const keep = new Set(children);
    for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
  }
  children(node, property) {
    return (node.collections[property] ?? []).map(value => value?.$ref ? this.ensure(value.$ref) : null).filter(Boolean);
  }
  content(parent, value) {
    if (value?.$ref) { const element = this.ensure(value.$ref); this.ordered(parent, element ? [element] : []); }
    else {
      const text = value == null || typeof value === 'object' ? '' : String(value);
      if (parent.textContent !== text || parent.children.length) parent.textContent = text;
    }
  }
  parentOf(id) {
    return this.layoutEngine.states.get(id)?.parent ?? this.parents.get(id) ?? null;
  }
  indexParents() {
    this.parents.clear();
    for (const node of this.nodes.values()) {
      for (const id of this.visualChildren(node)) this.parents.set(id, node.id);
    }
  }
  visualChildren(node) {
    if (node.templateRoot) return [node.templateRoot];
    if (node.templateOwner) {
      const owner = this.nodes.get(node.templateOwner);
      const children = owner && this.registry.resolve(owner.type)?.getTemplatePartChildren?.(this.context, owner, node);
      if (children !== undefined) return children;
    }
    if (node.templateOwner && node.properties.Name === 'PART_BehaviorRoot') {
      const owner = this.nodes.get(node.templateOwner);
      const family = owner && this.registry.resolve(owner.type);
      if (family?.virtualizesItems) return family.getVisualChildren?.(this.context, owner) ?? [];
    }
    const renderer = this.registry.resolve(node.type);
    if (renderer?.getVisualChildren) return renderer.getVisualChildren(this.context, node);
    if (!renderer?.virtualizesItems) return controls.defaultChildren(node);
    const children = [];
    for (const property of treeProperties) if (node.properties[property]?.$ref) children.push(node.properties[property].$ref);
    return children;
  }
  reachable() { return reachableNodes(this); }
  visualRoots() { return [...new Set([...this.windows, ...overlayRoots(this)])]; }
  layout(node, element) { controls.applyVisualProperties(this.context, node, element); }
  renderTransform() { /* The managed DOM applier publishes transforms after Arrange. */ }
  renderNode(node, element) {
    this.layout(node, element);
    const renderer = this.registry.resolve(node.type);
    if (node.templateRoot && !renderer?.handlesTemplate) {
      if (['Button', 'ToggleButton', 'AppBarButton', 'HyperlinkButton'].includes(suffix(node.type))) {
        controls.renderButtonContent(this.context, node, element);
      } else this.ordered(element, [this.ensure(node.templateRoot)].filter(Boolean));
    } else renderer?.render?.(this.context, node, element);
  }
  renderExtended(node, element) { this.registry.resolve(node.type)?.render?.(this.context, node, element); return true; }
  renderWrapPanel(node, element) { this.ordered(element, this.children(node, 'Children')); this.layoutEngine.invalidate(node.id); }

  render() {
    if (this.disposed || this.rendering) return;
    this.rendering = true;
    try {
      this.refreshEventListeners();
      refreshHostEnvironment(this);
      if (this.modelDirty) this.indexParents();
      const visible = this.reachable();
      this.renderVisible = visible;
      for (const id of visible) this.ensure(id);
      for (const id of visible) this.renderNode(this.nodes.get(id), this.elements.get(id));
      for (const id of visible) {
        const node = this.nodes.get(id);
        this.registry.resolve(node.type)?.afterRender?.(this.context, node, this.elements.get(id));
      }
      const rootLayers = [this.input.dragDrop.visual.element, this.services.overlays?.layer,
        ...(this.services.rootLayers ?? []), ...(this.automation?.layers ?? [])].filter(Boolean);
      this.ordered(this.root, [...this.windows, ...this.openFlyouts.keys()].map(id => this.ensure(id)).filter(Boolean).concat(rootLayers));
      for (const id of [...this.elements.keys()]) if (!visible.has(id)) this.removeElement(id);
      if (this.modelDirty) {
        this.layoutEngine.synchronize(this.nodes, this.windows);
        controls.synchronizeObjectTree(this);
        this.modelDirty = false;
      }
      this.layoutEngine.setScale(this.document.defaultView.devicePixelRatio || 1);
      updateHostLayout(this);
      this.layoutCommands.apply();
      if (this.layoutEngine.dirty.size) updateHostLayout(this);
      this.publishGeometry(true);
      for (const command of this.pendingFlyouts.splice(0)) this.flyout(command);
    } finally { this.rendering = false; this.renderVisible = null; }
  }

  renderOnly() {
    if (this.disposed || this.rendering) return;
    this.rendering = true;
    try { this.publishGeometry(false); }
    finally { this.rendering = false; }
  }
  publishGeometry(notifyLayout) {
    this.renderOnlyDirty = false;
    this.composition.begin();
    this.worldLayout = controls.computeWorldLayout(this.layoutEngine,
      { resolveNode: id => this.composition.resolve(id), composition: this.composition, transformResolver: this.services.renderTransform,
        rootTransform: id => this.portalTransforms?.get(id) });
    const changes = controls.applyLayoutToDom(this.layoutEngine, this.elements, this.worldLayout);
    for (const [id, layout] of this.worldLayout) {
      const node = this.nodes.get(id);
      if (node) this.registry.resolve(node.type)?.afterLayout?.(this.context, node, this.elements.get(id), layout);
    }
    this.input.update(this.worldLayout);
    controls.updateObjectTreeBounds(this);
    const handled = new Set();
    for (const [id, layout] of this.worldLayout) {
      this.composition.paint(id, this.elements.get(id));
      const node = this.composition.resolve(id);
      if (this.options.renderDelegate?.(this.context, node, layout) === true) handled.add(id);
      else this.drawNode(node);
    }
    this.automation?.update(this.worldLayout, handled);
    this.options.renderFrame?.(this.context);
    publishLayoutFeedback(this, changes, notifyLayout);
  }

  getLayout(id) { return this.worldLayout.get(id) ?? null; }
  layoutSnapshot() { return { version: 1, revision: this.layoutEngine.version, scale: this.layoutEngine.scale,
    nodes: [...this.worldLayout.values()].map(({ node, ...layout }) => layout) }; }

  drawNode(node) { drawLegacyNode(this, node); }

  emit(node, event, payload = {}) {
    if (!node || !node.events.includes(event) && !inputUpdates.has(event)) return;
    if (event === 'Click' && this.nativeEventSource && payload.OriginalSource == null) {
      payload = { ...payload, OriginalSource: this.nativeEventSource };
    }
    try { this.options.onEvent(node.id, event, payload); } catch (error) { this.options.onError(error); }
  }
  requestEvent(id, event, payload = {}, options = {}) { return this.eventRequests.request(id, event, payload, options); }
  handleEvent(type, event) { handleNativeEvent(this, type, event); }

  flyout({ id, anchor, show }) {
    const element = this.ensure(id);
    if (!element) return;
    if (!show) { element.hidden = true; this.openFlyouts.delete(id); return; }
    const target = this.elements.get(anchor);
    if (!target) return;
    this.openFlyouts.set(id, anchor);
    this.renderNode(this.nodes.get(id), element);
    const bounds = this.getLayout(anchor)?.bounds;
    this.root.append(element);
    Object.assign(element.style, { position: 'absolute', left: Math.max(0, bounds?.x ?? 0) + 'px',
      top: Math.max(0, (bounds?.y ?? 0) + (bounds?.height ?? 0)) + 'px', zIndex: '100', transform: '' });
    element.hidden = false;
    element.querySelector('button')?.focus();
  }
  hideFlyouts() {
    const last = [...this.openFlyouts.values()].at(-1);
    this.openFlyouts.clear();
    for (const element of this.elements.values()) if (element.classList.contains('sf-winui-flyout')) element.hidden = true;
    if (last) this.focusManager?.focus(last);
  }
  removeElement(id) {
    this.eventRequests.cancelTarget(id);
    const node = this.nodes.get(id);
    const element = this.elements.get(id);
    this.input?.removeNode(id, { removeHandlers: false });
    if (node && element) this.registry.resolve(node.type)?.dispose?.(this.context, node, element);
    this.states.get(id)?.dispose?.();
    this.states.get(id)?.scrollModel?.dispose();
    this.states.delete(id);
    element?.remove();
    this.elements.delete(id);
    this.surfaces.get(id)?.dispose();
    this.surfaces.delete(id);
    this.layouts.delete(id);
    this.privateValues.delete(id);
    this.automation?.bridge.remove(element);
    this.options.onElementRemoved?.(id, element);
  }
  flush() {
    if (this.frame) { (this.document.defaultView.cancelAnimationFrame?.bind(this.document.defaultView) ?? clearTimeout)(this.frame); this.frame = 0; }
    this.render();
  }
  async settled() { this.flush(); await Promise.all([...this.surfaces.values()].map(surface => surface.ready)); this.flush(); }
  dispose() {
    if (this.disposed) return;
    if (this.frame) (this.document.defaultView.cancelAnimationFrame?.bind(this.document.defaultView) ?? clearTimeout)(this.frame);
    this.unregisterFrame?.();
    this.unregisterRenderFrame?.();
    disposeHostEnvironment(this);
    for (const [type, { listener, capture }] of this.listeners) this.root.removeEventListener(type, listener, capture);
    this.listeners.clear();
    this.eventRequests.dispose();
    this.input.dispose();
    for (const id of [...this.elements.keys()]) this.removeElement(id);
    this.layoutEngine.dispose();
    this.automation?.dispose();
    if (this.services.overlays !== this.externalOverlays) this.services.overlays?.dispose();
    this.composition.clear();
    this.layoutCommands.clear();
    this.nodes.clear();
    this.parents.clear();
    this.privateValues.clear();
    this.windows = [];
    this.openFlyouts.clear();
    this.root.replaceChildren();
    delete this.root.dataset.sfRoot;
    this.disposed = true;
  }
}
