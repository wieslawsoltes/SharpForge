import {RenderSurface} from '../backends/surface.js';
import {GpuDevice} from '../webgpu/device.js';
import {ResourceTable} from '../resources/resource-table.js';
import {BrowserTextProvider} from '../text/browser-provider.js';
import {TextLayoutService} from '../text/layout.js';
import {createControlRenderers} from './delegates.js';
import {drawingCommandsToDisplayList} from '../drawing/legacy.js';
import {captureVisualDisplayList} from './capture.js';
import {displayListBounds} from '../drawing/bounds.js';
import {DrawingContext} from '../drawing/context.js';
import {encodeCompositionLayers} from '../composition/content.js';
import {systemBackdropPolicy} from '../brushes/effects.js';
import {normalizeBrush} from '../brushes/brushes.js';
import {cssColor} from '../media/colors.js';
import {applyVisualShadow} from './shadow-renderer.js';
import {RetainedPlacement} from './placement.js';
import {controlColorPolicy} from './color-policy.js';

/** Explicit app-scoped rendering services; per-element layers preserve DOM/GPU interleaving and inherited composition. */
export class RetainedSceneRenderer {
  constructor(root, {backend = 'auto', gpu = globalThis.navigator?.gpu, resources, deviceService, textService,
    onMetrics = () => {}, onError = () => {}, resolveImage, resolveType, disabledOperations = [], blendColorSpace = 'srgb'} = {}) {
    this.root = root; this.document = root.ownerDocument; this.backend = backend; this.gpu = gpu;
    this.resources = resources ?? new ResourceTable(); this.ownsResources = !resources;
    this.deviceService = deviceService ?? new GpuDevice({gpu}); this.ownsDevice = !deviceService;
    this.textService = textService ?? new TextLayoutService(new BrowserTextProvider(this.document)); this.ownsText = !textService;
    this.onMetrics = onMetrics; this.onError = onError; this.resolveImage = resolveImage;
    this.registry = createControlRenderers({resolveType}); this.entries = new Map(); this.compositionEntries = new Map();
    this.seen = new Set(); this.closed = false; this.disabledOperations = disabledOperations;
    this.colorSpace = blendColorSpace;
    this.unsubscribeText = this.textService.subscribe?.(() => {
      for (const [id, entry] of this.entries) { entry.key = null; this.host?.invalidate(id, 'measure'); }
      this.host?.schedule();
    });
  }
  collect(host, node, layout) {
    if (this.closed) return false;
    this.host = host;
    const type = node.type.split('.').at(-1), delegate = this.registry.get(node.type);
    if (!delegate && type !== 'DrawingSurface') return false;
    const element = host.elements.get(node.id);
    if (!element) return false;
    let preserveBackground = false;
    const resolve = value => value?.$ref ? host.nodes.get(value.$ref) : value;
    const colors = controlColorPolicy(node, host.services, this.resources, resolve);
    let paintedNode = colors.node;
    if (paintedNode.properties.SystemBackdrop) {
      const value = resolve(node.properties.SystemBackdrop), kind = (value.type ?? value.valueType).split('.').at(-1);
      const policy = systemBackdropPolicy(kind, {theme: host.root.dataset.theme ?? 'light',
        highContrast: this.document.defaultView.matchMedia?.('(forced-colors: active)').matches ?? false});
      element.style.background = policy.color; element.style.backdropFilter = policy.blur ? `blur(${policy.blur}px)` : '';
      preserveBackground = true; this.onMetrics({id: node.id, backend: 'dom', operation: 'system-backdrop', ...policy});
    }
    if (this.backend === 'dom' && paintedNode.properties.Background) {
      const brush = normalizeBrush(paintedNode.properties.Background, this.resources, resolve);
      if (brush?.kind === 'acrylic' && !brush.alwaysUseFallback && this.document.defaultView.CSS?.supports?.('backdrop-filter', 'blur(1px)')) {
        const tint = [...brush.tint]; tint[3] *= brush.tintOpacity * brush.opacity;
        element.style.background = cssColor(tint); element.style.backdropFilter = `blur(${brush.blur}px) saturate(125%)`;
        paintedNode = {...paintedNode, properties: {...paintedNode.properties, Background: null}}; preserveBackground = true;
        this.onMetrics({id: node.id, backend: 'dom', operation: 'acrylic', reason: 'CSS in-app backdrop-filter material'});
      }
    }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'IMG'].includes(element.tagName)) {
      element.dataset.renderFallback = element.tagName === 'IMG' ? 'Native image decode and accessibility surface' : 'Native text/input overlay';
      this.onMetrics({id: node.id, version: 1, requested: this.backend, backend: 'dom',
        reason: element.dataset.renderFallback, physicalHardware: 'unqualified'});
      return false;
    }
    this.seen.add(node.id);
    let entry = this.entries.get(node.id);
    if (entry && entry.element !== element) {
      entry.surface?.dispose(); entry.placement.dispose(); this.entries.delete(node.id); entry = null;
    }
    if (!entry) {
      entry = {element, surface: null, key: null, list: null, placement: new RetainedPlacement(node.id, this.resources)};
      this.entries.set(node.id, entry);
    }
    const rect = layout.rect ?? layout, width = rect.width ?? layout.renderSize?.width ?? 0, height = rect.height ?? layout.renderSize?.height ?? 0;
    const key = JSON.stringify([paintedNode.version ?? paintedNode.revision ?? paintedNode.properties,
      node.collections, node.drawing, node.drawingList, host.states.get(node.id)?.imageHandle, width, height, colors.revision]);
    if (entry.key !== key) {
      const options = {resolve, textService: this.textService, forcedForeground: colors.foreground,
        textScale: host.services.textScale?.factor ?? 1,
        resolveImage: source => this.resolveImage?.(source, host, node) ?? host.states.get(node.id)?.imageHandle ??
          (typeof source === 'object' ? source : null),
        version: (entry.list?.version ?? 0) + 1, onTextLayout: (id, run) => { entry.textLayout = run; }};
      entry.list = type === 'DrawingSurface' ? drawingCommandsToDisplayList(node.drawing ?? [], options.version) :
        this.registry.encode(paintedNode, {rect: {x: 0, y: 0, width, height}, bounds: [0, 0, width, height]}, this.resources, options);
      entry.list = applyVisualShadow(entry.list, paintedNode, {resolve, theme: host.root.dataset.theme});
      const painted = displayListBounds(entry.list, this.resources, {resolve}), left = Math.min(0, Math.floor(painted[0]));
      const top = Math.min(0, Math.floor(painted[1]));
      entry.outset = [left, top]; entry.renderWidth = Math.max(width, Math.ceil(painted[0] + painted[2])) - left;
      entry.renderHeight = Math.max(height, Math.ceil(painted[1] + painted[3])) - top;
      entry.key = key; entry.changed = true;
    }
    const placed = entry.placement.update(entry.list, layout, entry.outset);
    if (placed !== entry.renderList) { entry.renderList = placed; entry.changed = true; }
    entry.width = Math.max(1, width); entry.height = Math.max(1, height);
    if (!entry.list?.commands.some(command => command.op >= 16)) { entry.surface?.dispose(); entry.surface = null; return true; }
    if (!entry.surface) entry.surface = new RenderSurface(element, {backend: this.backend, gpu: this.gpu, deviceService: this.deviceService,
      resources: this.resources, textService: this.textService, onError: this.onError, disabledOperations: this.disabledOperations,
      blendColorSpace: this.colorSpace,
      onMetrics: metrics => this.onMetrics({id: node.id, layerPolicy: 'element-stacking-context', ...metrics})});
    const drawing = entry.surface.canvas ?? entry.surface.domLayer;
    if (drawing && drawing.parentNode !== element) element.prepend(drawing);
    if (drawing) Object.assign(drawing.style, {position: 'absolute',
      left: `${entry.outset[0] - (node.properties.BorderThickness?.Left ?? 0)}px`,
      top: `${entry.outset[1] - (node.properties.BorderThickness?.Top ?? 0)}px`, pointerEvents: 'none'});
    if (!element.style.position || element.style.position === 'static') element.style.position = 'relative';
    if (!preserveBackground) element.style.background = 'transparent';
    element.style.borderColor = 'transparent';
    const imageState = host.states.get(node.id);
    if (type === 'Image' && imageState?.imageReady) entry.surface.ready.then(() => {
      if (!entry.surface?.disposed && imageState.imageReady) imageState.nativeImage.style.visibility = 'hidden';
    }).catch(this.onError);
    if (type === 'TextBlock' || type === 'RichTextBlock') element.style.color = 'transparent';
    delete element.dataset.renderFallback;
    return true;
  }
  renderFrame() {
    const dpr = this.document.defaultView?.devicePixelRatio ?? 1;
    for (const [id, entry] of this.entries) {
      if (!this.seen.has(id)) { entry.surface?.dispose(); entry.placement.dispose(); this.entries.delete(id); continue; }
      if (!entry.surface) continue;
      if (entry.changed || entry.dpr !== dpr || entry.resourceVersion !== this.resources.version) {
        entry.surface.updateDisplayList(entry.renderList, this.resources, entry.renderWidth, entry.renderHeight, dpr);
        entry.changed = false; entry.dpr = dpr; entry.resourceVersion = this.resources.version;
      }
    }
    this.seen.clear();
  }
  collectComposition(host, id, layer, resources) {
    let entry = this.compositionEntries.get(id);
    if (!layer) { entry?.surface.dispose(); entry?.container.remove(); this.compositionEntries.delete(id); return; }
    const element = host.elements.get(id), layout = host.getLayout(id);
    if (!element || !layout) return;
    if (!entry) {
      const container = this.document.createElement('div'); container.setAttribute('aria-hidden', 'true');
      Object.assign(container.style, {position: 'absolute', pointerEvents: 'none', left: '0', top: '0'});
      const surface = new RenderSurface(container, {backend: this.backend, gpu: this.gpu, deviceService: this.deviceService,
        resources, textService: this.textService, onError: this.onError, backdropAvailable: true,
        blendColorSpace: this.colorSpace,
        onMetrics: metrics => this.onMetrics({id, layerPolicy: 'element-composition-child', ...metrics})});
      entry = {surface, container}; this.compositionEntries.set(id, entry);
    }
    element.append(entry.container);
    const list = encodeCompositionLayers([layer]), bounds = displayListBounds(list, resources);
    const left = Math.min(0, bounds[0]), top = Math.min(0, bounds[1]), width = Math.max(layout.renderSize.width, bounds[0] + bounds[2]) - left;
    const height = Math.max(layout.renderSize.height, bounds[1] + bounds[3]) - top;
    const drawing = new DrawingContext(); drawing.PushTransform([1, 0, 0, 1, -left, -top]); drawing.DrawLayer({displayList: list}); drawing.Pop();
    entry.container.style.left = `${left}px`; entry.container.style.top = `${top}px`;
    entry.list = list; entry.resources = resources;
    entry.surface.updateDisplayList(drawing.finish(), resources, width, height, this.document.defaultView.devicePixelRatio || 1);
  }
  setBackend(backend) {
    if (this.backend === backend) return;
    this.backend = backend;
    for (const entry of this.entries.values()) { entry.surface?.dispose(); entry.placement.dispose(); }
    this.entries.clear();
    for (const entry of this.compositionEntries.values()) { entry.surface.dispose(); entry.container.remove(); }
    this.compositionEntries.clear();
  }
  async settled() { await Promise.all([...this.entries.values(), ...this.compositionEntries.values()].map(entry => entry.surface?.ready)); }
  capture(id) { return captureVisualDisplayList(this.host, this.entries, id, this.compositionEntries, this.resources); }
  dispose() {
    if (this.closed) return; this.closed = true; this.unsubscribeText?.();
    for (const entry of this.entries.values()) { entry.surface?.dispose(); entry.placement.dispose(); } this.entries.clear();
    for (const entry of this.compositionEntries.values()) { entry.surface.dispose(); entry.container.remove(); } this.compositionEntries.clear();
    this.imageCache?.dispose();
    if (this.ownsResources) this.resources.dispose(); if (this.ownsDevice) this.deviceService.dispose();
    if (this.ownsText) this.textService.dispose();
  }
}
