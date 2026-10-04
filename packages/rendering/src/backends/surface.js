import {GpuDevice} from '../webgpu/device.js';
import {ResourceTable} from '../resources/resource-table.js';
import {WebGpuBackend} from './webgpu.js';
import {Canvas2DBackend} from './canvas2d.js';
import {SvgBackend} from './svg.js';
import {DrawingError, finite} from '../drawing/commands.js';
import {primitivesToDisplayList} from '../drawing/legacy.js';
import {blendColorSpace} from '../media/working-color.js';

/** Backwards-compatible surface facade with explicit app-owned device/resources and recoverable backend selection. */
export class RenderSurface {
  constructor(container, {backend = 'auto', gpu = globalThis.navigator?.gpu, deviceService, resources, textService,
    onMetrics = () => {}, onError = () => {}, createCanvas, disabledOperations = [], backdropAvailable = false,
    blendColorSpace: workingSpace = 'srgb'} = {}) {
    if (!container?.ownerDocument) throw new TypeError('RenderSurface requires a document container');
    if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(backend)) throw new TypeError('Unknown rendering backend');
    this.container = container; this.document = container.ownerDocument; this.requested = backend; this.gpu = gpu;
    this.service = deviceService ?? new GpuDevice({gpu}); this.ownsService = !deviceService;
    this.resources = resources ?? new ResourceTable(); this.ownedResources = resources ? null : this.resources; this.textService = textService;
    this.onMetrics = onMetrics; this.onError = onError; this.backend = 'initializing'; this.reason = '';
    this.disposed = false; this.primitives = []; this.width = this.height = this.dpr = 1; this.version = 0;
    this.renderer = null; this.canvas = null; this.domLayer = null; this.fallbacks = []; this.epoch = 0;
    this.disabledOperations = disabledOperations; this.backdropAvailable = backdropAvailable;
    this.colorSpace = blendColorSpace(workingSpace);
    this.createCanvas = createCanvas ?? ((width, height) => { const canvas = this.document.createElement('canvas');
      canvas.width = width; canvas.height = height; return canvas; });
    this.list = primitivesToDisplayList([]);
    this.unsubscribe = this.service.subscribe(event => this.deviceState(event));
    this.unsubscribeText = this.textService?.subscribe?.(() => {
      if (this.textFramePending) return;
      this.textFramePending = true;
      queueMicrotask(() => {
        this.textFramePending = false;
        try { this.draw(); } catch (error) { this.onError(error); }
      });
    });
    this.ready = this.initialize();
  }
  get device() { return this.renderer?.device ?? this.service.device; }
  get context() { return this.renderer?.context ?? null; }
  get pipeline() { return this.renderer?.pipelines?.draw ?? null; }
  get uniform() { return this.renderer?.uniform ?? null; }
  replaceCanvas() {
    this.canvas?.remove(); this.domLayer?.remove(); this.domLayer = null;
    this.canvas = this.createCanvas(1, 1); this.canvas.className = 'sf-winui-canvas';
    this.canvas.setAttribute('aria-hidden', 'true'); this.container.prepend(this.canvas); return this.canvas;
  }
  async initialize() {
    const epoch = ++this.epoch;
    if (!['canvas2d', 'dom'].includes(this.requested) && this.gpu) {
      try {
        this.renderer?.dispose();
        const renderer = new WebGpuBackend(this.replaceCanvas(), this.service, {textService: this.textService, disabledOperations: this.disabledOperations,
          blendColorSpace: this.colorSpace,
          onFallback: entry => this.fallbacks.push(entry)});
        this.renderer = renderer;
        await renderer.ready;
        if (this.disposed || epoch !== this.epoch) { renderer.dispose(); return; }
        this.backend = 'webgpu'; this.reason = ''; this.draw(); return;
      } catch (error) {
        if (this.disposed || epoch !== this.epoch) return;
        this.reason = error.message; this.renderer?.dispose(); this.renderer = null;
      }
    } else if (!['canvas2d', 'dom'].includes(this.requested)) this.reason = 'WebGPU is unavailable';
    this.fallback(); this.draw();
  }
  deviceState(event) {
    if (this.disposed || ['dom', 'canvas2d'].includes(this.requested)) return;
    if (event.state === 'lost') {
      this.recovering = true; this.reason = `WebGPU device lost: ${event.reason}`; this.epoch++;
      this.fallback(); this.draw();
    } else if (event.state === 'ready' && this.recovering) {
      this.recovering = false; this.ready = this.initialize();
    } else if (event.state === 'unavailable' && this.recovering) {
      this.recovering = false; this.reason = event.reason; this.fallback(); this.draw();
    }
  }
  fallback() {
    if (this.disposed) return;
    this.renderer?.dispose(); this.renderer = null;
    if (this.requested !== 'dom') {
      try {
        this.renderer = new Canvas2DBackend(this.replaceCanvas(), {createCanvas: this.createCanvas, textService: this.textService,
          onFallback: entry => this.fallbacks.push(entry)});
        this.backend = 'canvas2d'; return;
      } catch (error) { this.reason = [this.reason, error.message].filter(Boolean).join('; '); }
    }
    this.canvas?.remove(); this.canvas = null;
    this.renderer = new SvgBackend(this.container, {createCanvas: this.createCanvas, textService: this.textService,
      onFallback: entry => this.fallbacks.push(entry)});
    this.domLayer = this.renderer.svg; this.domLayer.classList.add('sf-winui-dom-drawing'); this.backend = 'dom';
  }
  update(primitives, width, height, dpr = globalThis.devicePixelRatio ?? 1) {
    const list = primitivesToDisplayList(primitives, ++this.version);
    this.primitives = primitives; this.updateDisplayList(list, this.resources, width, height, dpr);
  }
  updateDisplayList(list, resources = this.resources, width = this.width, height = this.height, dpr = this.dpr) {
    if (this.disposed) throw new DrawingError('SFRENDER121', 'RenderSurface is disposed');
    this.list = list; this.resources = resources;
    this.width = Math.max(1, finite(width, 'surface width', 0, 1000000));
    this.height = Math.max(1, finite(height, 'surface height', 0, 1000000));
    this.dpr = Math.max(0.25, Math.min(finite(dpr, 'device pixel ratio', 0.25, 8), 4)); this.draw();
  }
  draw() {
    if (this.disposed || this.backend === 'initializing' || !this.renderer) return;
    const begin = globalThis.performance?.now?.() ?? 0;
    const limit = this.backend === 'webgpu' ? this.service.device?.limits?.maxTextureDimension2D ?? 8192 : 16384;
    const pixels = this.colorSpace === 'linear' && this.backend !== 'webgpu' ? 4194304 : 16777216;
    const scale = Math.min(this.dpr, Math.sqrt(pixels / (this.width * this.height)), limit / this.width, limit / this.height);
    if (this.canvas) { this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`; }
    this.fallbacks.length = 0;
    let result;
    const options = {width: this.width, height: this.height, dpr: scale, backdropAvailable: this.backdropAvailable,
      blendColorSpace: this.colorSpace, textVersion: this.textService?.provider?.fontVersion ?? 0};
    try { result = this.renderer.render(this.list, this.resources, options); }
    catch (error) {
      if (this.backend !== 'webgpu') { this.onError(error); throw error; }
      this.reason = error.message; this.fallback();
      result = this.renderer.render(this.list, this.resources, options);
    }
    const metrics = {version: 1, requested: this.requested, reason: this.reason, primitives: this.primitives.length,
      commands: this.list.commands.length, submitMs: (globalThis.performance?.now?.() ?? begin) - begin,
      fallbacks: [...this.fallbacks], physicalHardware: 'unqualified', effectiveDpr: scale,
      resolutionPolicy: scale < this.dpr ? 'downsampled-to-pixel-budget' : 'native-dpr', ...result};
    delete metrics.completion; this.onMetrics(metrics);
    result?.completion?.then(() => { if (!this.disposed) this.onMetrics({...metrics,
      gpuDoneMs: (globalThis.performance?.now?.() ?? begin) - begin}); }, error => this.onError(error));
  }
  setBackend(backend) {
    if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(backend)) throw new TypeError('Unknown rendering backend');
    if (this.requested === backend) return this.ready;
    this.requested = backend; this.reason = ''; this.ready = this.initialize(); return this.ready;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++; this.unsubscribe(); this.unsubscribeText?.(); this.renderer?.dispose(); this.renderer = null;
    this.canvas?.remove(); this.domLayer?.remove(); this.canvas = this.domLayer = null;
    this.ownedResources?.dispose();
    if (this.ownsService) this.service.dispose();
  }
}
