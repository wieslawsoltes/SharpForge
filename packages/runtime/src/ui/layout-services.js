import { LayoutEngine, createLayoutRegistry, createLayoutOperations, computeWorldLayout, defaultChildren,
  size, createContextEnvironment, environmentLayoutProperties, observeLayoutControlEvent } from '@sharpforge/winui-controls';
import { frameworkType } from '@sharpforge/framework';
import { ManagedFault } from '../heap.js';
import { collectManagedLayoutScene, reconcileManagedLayoutScene, layoutReference } from './layout-scene.js';
import { createManagedMeasureProvider, registerManagedLayoutOverride, layoutSize, managedLayoutSize } from './layout-overrides.js';
import { ManagedLayoutInput } from './layout-input-state.js';
import { readLayoutFeedback, scrollMetrics } from './layout-feedback.js';
import { invokeBrowserScroll, observeManagedScroll } from './layout-scroll-services.js';

const sameSize = (left, right) => left?.Width === right.Width && left?.Height === right.Height;
const directions = new Set(['GetFocusedElement', 'FindNextElement']);

/** VM-owned, synchronous layout. Browser feedback changes geometry, never the source object graph. */
export class ManagedLayoutServices {
  constructor(context, options = {}) {
    this.context = context;
    this.options = options;
    this.nodes = new Map();
    this.states = new Map();
    this.customTypes = new Set();
    this.worldLayout = new Map();
    this.feedback = new Map();
    this.windows = [];
    this.active = 0;
    this.disposed = false;
    this.suppressNotifications = false;
    this.nextScrollCorrelationId = 1;
    const environment = createContextEnvironment(context);
    const provider = createManagedMeasureProvider(context, options, id => this.nodes.get(id));
    this.engine = new LayoutEngine({ registry: createLayoutRegistry({ resolveType: frameworkType }), measureProvider: provider,
      resolveChildren: node => options.resolveChildren?.(node, this) ?? defaultChildren(node, this.nodes),
      scale: options.scale ?? environment.RasterizationScale, onArrange: state => this.publishState(state),
      resolveProperties: node => environmentLayoutProperties(node, environment) });
    this.unregisterEnvironment = environment.subscribe(() => {
      this.engine.setScale(environment.RasterizationScale);
      provider.setTextScaleFactor?.(environment.TextScaleFactor);
      provider.invalidate?.();
      for (const id of this.nodes.keys()) this.engine.invalidate(id);
      this.feedback.clear();
    });
    this.inputState = new ManagedLayoutInput(this);
    this.focusManager = this.inputState.focus;
    this.host = this.createHost();
    this.operations = createLayoutOperations(this.host);
  }
  createHost() {
    return { nodes: this.nodes, layoutEngine: this.engine, focusManager: this.focusManager,
      services: this.context.services, options: this.options,
      input: { capture: this.inputState, frameClock: this.options.scrollFrames ?? this.context.services.scrollFrames },
      context: { nodes: this.nodes, resolve: id => this.nodes.get(id),
        emit: (node, event, payload) => this.emit(node.id, event, payload),
        invalidate: (id, kind) => this.invalidate(id, kind),
        getState: node => {
        if (!this.states.has(node.id)) this.states.set(node.id, {});
        return this.states.get(node.id);
      } }, invalidate: (id, kind) => this.invalidate(id, kind), flush: () => this.updateLayout(),
      emit: (node, event, payload) => {
        const model = this.states.get(node.id)?.scrollModel;
        if (model) for (const [property, value] of [['HorizontalOffset', model.horizontalOffset],
          ['VerticalOffset', model.verticalOffset], ['ZoomFactor', model.zoomFactor]]) this.setOutput(node.id, property, value);
        this.emit(node.id, event, payload);
      } };
  }
  reference(value) { return layoutReference(this.context, value); }
  identity(value) { return value == null ? null : this.context.id(this.reference(value)); }
  synchronize(receiver = null) {
    if (this.disposed) throw new ManagedFault('ObjectDisposedException', 'Layout service is disposed');
    if (this.active) return;
    const scene = collectManagedLayoutScene(this.context, receiver);
    const previous = new Map(this.nodes);
    reconcileManagedLayoutScene(this.context, scene, this.nodes, (type, base) => registerManagedLayoutOverride(this, type, base));
    this.windows = scene.windows;
    this.engine.synchronize(this.nodes, this.windows);
    const explicit = this.identity(receiver);
    if (explicit && !this.engine.states.get(explicit)?.parent && !this.engine.roots.includes(explicit)) this.engine.roots.push(explicit);
    for (const id of previous.keys()) if (!this.nodes.has(id)) {
      this.states.get(id)?.scrollModel?.dispose();
      this.states.delete(id);
      this.inputState.releaseAll(id);
      this.focusManager.removeNode(id);
    }
    if (previous.size !== this.nodes.size || [...this.nodes].some(([id, node]) => previous.get(id) !== node)) {
      this.feedback.clear();
      this.worldLayout.clear();
    }
    const tree = this.context.objectTree ?? this.context.services.objectTree;
    if (tree) {
      for (const id of this.nodes.keys()) tree.register(id, { value: this.reference(id), root: this.windows.includes(id) });
      for (const state of this.engine.states.values()) tree.setVisualParent(state.id, state.parent);
    }
  }
  invoke(receiver, name, args = []) {
    this.synchronize(receiver);
    const id = this.identity(receiver);
    this.active++;
    try {
      if (['TryGetElement', 'GetElementIndex'].includes(name)) return this.itemOperation(receiver, name, args);
      const browserScroll = invokeBrowserScroll(this, id, name, args);
      if (browserScroll) return browserScroll.value;
      const result = this.operations.invoke(id, name, args);
      if (!result.handled) throw new ManagedFault('MissingMethodException', 'Unsupported layout operation: ' + name);
      if (name === 'Measure') this.publishState(this.engine.states.get(id), false);
      if (['Measure', 'Arrange', 'ChangeView', 'ScrollTo', 'ScrollBy', 'ZoomTo',
        'RegisterAnchorCandidate', 'UnregisterAnchorCandidate', 'CompleteControllerScroll'].includes(name)) {
        this.publishGeometry();
        this.notify(id, name, args);
      }
      return directions.has(name) && result.value != null ? this.reference(result.value) : result.value;
    } finally { this.active--; }
  }
  itemOperation(receiver, name, args) {
    const generator = this.options.itemGenerator?.(receiver) ?? this.context.services.itemGenerator?.(receiver);
    if (!generator) throw new ManagedFault('NotSupportedException', 'SFLAYOUT004: ItemsRepeater requires the shared item generator');
    if (name === 'TryGetElement') {
      const result = generator.elementAt?.(args[0]) ?? generator.containerFromIndex?.(args[0]);
      return result == null ? null : this.reference(result);
    }
    return generator.indexOfElement?.(args[0]) ?? generator.indexFromContainer?.(args[0]) ?? -1;
  }
  invokeBaseOverride(receiver, name, dimensions, base = null) {
    this.synchronize(receiver);
    const id = this.identity(receiver);
    const state = this.engine.states.get(id);
    if (!state) throw new ManagedFault('ArgumentException', 'Unknown layout element');
    const algorithm = this.engine.registry.resolve(base ?? state.node.frameworkType ?? state.node.type);
    const callback = name === 'MeasureOverride' ? algorithm?.measure : algorithm?.arrange;
    const constraint = layoutSize(dimensions);
    this.active++;
    try {
      const result = callback?.(this.engine.context(state), constraint);
      if (result !== undefined) return result;
      return name === 'MeasureOverride' ? this.engine.context(state).intrinsic(constraint) : constraint;
    } finally { this.active--; }
  }
  invalidate(receiver, kind = 'measure') {
    const id = this.identity(receiver);
    this.engine.invalidate(id, kind);
    this.feedback.clear();
    this.notify(id, kind === 'arrange' ? 'InvalidateArrange' : 'InvalidateMeasure', []);
  }
  viewport(receiver = null) {
    const configured = this.options.getViewport?.(receiver, this) ?? this.context.services.getLayoutViewport?.(receiver)
      ?? this.context.platform.options.uiViewport;
    if (configured) return layoutSize(configured);
    const rootValue = this.options.getRoot?.(receiver, this);
    const rootId = rootValue == null ? this.engine.roots[0] : this.identity(rootValue);
    const supplied = this.feedback.get(rootId)?.renderSize;
    if (supplied) return size(supplied.width, supplied.height);
    const state = this.engine.states.get(rootId);
    const width = state?.node.properties.Width;
    const height = state?.node.properties.Height;
    if (Number.isFinite(width) && Number.isFinite(height)) return size(width, height);
    if (state?.slot.width > 0 && state?.slot.height > 0) return size(state.slot.width, state.slot.height);
    throw new ManagedFault('NotSupportedException', 'SFLAYOUT001: UpdateLayout requires a root viewport or browser layout feedback');
  }
  updateLayout() {
    this.synchronize();
    const viewport = this.viewport();
    this.active++;
    try { this.engine.updateLayout(viewport); this.publishGeometry(); }
    finally { this.active--; }
    this.notify(null, 'UpdateLayout', []);
  }
  publishState(state, arranged = true) {
    if (!state) return;
    this.setOutput(state.id, 'DesiredSize', managedLayoutSize(state.desiredSize));
    if (!arranged) return;
    this.setOutput(state.id, 'RenderSize', managedLayoutSize(state.renderSize));
    this.setOutput(state.id, 'ActualWidth', state.renderSize.width);
    this.setOutput(state.id, 'ActualHeight', state.renderSize.height);
    for (const [property, value] of Object.entries(scrollMetrics(state) ?? {})) this.setOutput(state.id, property, value);
    for (const [tracks, property] of [[state.data.grid?.rows, 'ActualHeight'], [state.data.grid?.columns, 'ActualWidth']]) {
      for (const track of tracks ?? []) if (track.id) this.setOutput(track.id, property, track.actual);
    }
  }
  setOutput(id, property, value) {
    const reference = this.reference(id);
    if (!this.context.propertiesFor(this.context.typeOf(reference))[property]) return;
    const current = this.context.native(this.context.read(reference, property));
    if (Object.is(current, value) || value?.valueType === 'Windows.Foundation.Size' && sameSize(current, value)) return;
    this.context.write(reference, property, value);
    const node = this.nodes.get(id);
    if (node) node.properties[property] = this.context.platform.exportValue(this.context.read(reference, property));
  }
  publishGeometry() {
    this.worldLayout = computeWorldLayout(this.engine, { transformResolver: this.context.services.renderTransform });
    const tree = this.context.objectTree ?? this.context.services.objectTree;
    for (const [id, layout] of this.worldLayout) tree?.setBounds(id, layout.bounds);
  }
  getLayout(receiver) {
    this.synchronize(receiver);
    const id = this.identity(receiver);
    if (!this.worldLayout.has(id)) this.publishGeometry();
    return this.feedback.get(id) ?? this.worldLayout.get(id) ?? null;
  }
  getDesiredSize(receiver) { this.synchronize(receiver); return this.engine.states.get(this.identity(receiver))?.desiredSize ?? size(); }
  getRenderSize(receiver) {
    this.synchronize(receiver);
    return this.feedback.get(this.identity(receiver))?.renderSize ?? this.engine.states.get(this.identity(receiver))?.renderSize ?? size();
  }
  getScrollMetrics(receiver) { this.synchronize(receiver); return scrollMetrics(this.engine.states.get(this.identity(receiver))); }
  updateFeedback(snapshot) {
    this.synchronize();
    this.feedback = readLayoutFeedback(this.context, snapshot);
    if (Number.isFinite(snapshot.scale)) this.engine.setScale(snapshot.scale);
    for (const [id, geometry] of this.feedback) {
      const state = this.engine.states.get(id);
      if (!state) continue;
      state.desiredSize = geometry.desiredSize;
      this.setOutput(id, 'DesiredSize', managedLayoutSize(geometry.desiredSize));
      this.setOutput(id, 'RenderSize', managedLayoutSize(geometry.renderSize));
      this.setOutput(id, 'ActualWidth', geometry.renderSize.width);
      this.setOutput(id, 'ActualHeight', geometry.renderSize.height);
      if (geometry.scroll) {
        state.data.scroll = geometry.scroll;
        state.data.currentAnchor = geometry.scroll.currentAnchor ?? null;
        for (const [property, value] of Object.entries(scrollMetrics(state))) this.setOutput(id, property, value);
      }
      (this.context.objectTree ?? this.context.services.objectTree)?.setBounds(id, geometry.bounds);
    }
  }
  observePointer(payload, eventName) { this.inputState.observePointer(payload, eventName); }
  observeScrollEvent(receiver, event, payload) {
    if (observeLayoutControlEvent(this.context, receiver, event, payload)) return;
    this.synchronize(receiver);
    observeManagedScroll(this, receiver, event, payload);
  }
  completeManipulation(source) { this.notify(this.identity(source), 'CompleteManipulation', []); }
  pointerEvent(receiver) { return this.context.state(receiver, 'uiEventPayload')?.payload; }
  notify(id, method, args, extra = {}) {
    if (this.suppressNotifications || this.disposed) return;
    const command = { op: 'layout', id, method, args, ...extra };
    if (this.options.notifyHost) this.options.notifyHost(command);
    else this.context.platform.command(command);
  }
  emit(id, event, payload) { if (id != null && !this.disposed) this.context.emit(this.reference(id), event, payload); }
  *retainedValues() { yield* this.inputState.retainedValues(); }
  snapshot() {
    return { version: 1, scale: this.engine.scale, input: this.inputState.snapshot(), feedback: [...this.feedback.values()],
      nextScrollCorrelationId: this.nextScrollCorrelationId,
      states: [...this.engine.states.values()].map(state => ({ id: state.id, desiredSize: state.desiredSize,
        renderSize: state.renderSize, rect: state.rect, slot: state.slot, constraint: state.constraint })) };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ManagedFault('ArgumentException', 'Invalid managed layout snapshot');
    this.suppressNotifications = true;
    try {
      this.nodes.clear();
      this.worldLayout.clear();
      this.synchronize();
      this.engine.setScale(snapshot.scale);
      this.nextScrollCorrelationId = snapshot.nextScrollCorrelationId ?? 1;
      for (const state of this.states.values()) {
        state.scrollModel?.dispose();
        state.annotatedController?.dispose();
      }
      this.states.clear();
      this.inputState.restore(snapshot.input);
      this.feedback = readLayoutFeedback(this.context, { version: 1, nodes: snapshot.feedback });
      for (const value of snapshot.states) {
        const state = this.engine.states.get(value.id);
        if (state) Object.assign(state, value, { measureDirty: true, arrangeDirty: true });
      }
      this.publishGeometry();
    } finally { this.suppressNotifications = false; }
  }
  dispose() {
    if (this.disposed) return;
    this.suppressNotifications = true;
    this.inputState.dispose();
    this.unregisterEnvironment();
    for (const state of this.states.values()) { state.scrollModel?.dispose(); state.annotatedController?.dispose(); }
    this.states.clear();
    this.engine.dispose();
    this.nodes.clear();
    this.feedback.clear();
    this.worldLayout.clear();
    this.disposed = true;
  }
}

export function createManagedLayoutServices(context, options = {}) {
  return context.state(null, 'layoutService', () => new ManagedLayoutServices(context, options));
}
