import {RenderSurface, ResourceTable, GpuDevice} from '@sharpforge/rendering';
import {createFixture} from './fixtures/scenes.js';
import {canvasPixels, pixelPacket} from './rgba.js';

function adapterDescription(service) {
  const info = service.adapter?.info ?? {};
  return {vendor: info.vendor ?? null, architecture: info.architecture ?? null, device: info.device ?? null,
    description: info.description ?? null, driver: null, driverSource: 'WebGPU does not expose a standard driver-version field',
    isFallbackAdapter: service.adapter?.isFallbackAdapter ?? info.isFallbackAdapter ?? null};
}

async function readPixels(surface) {
  if (surface.backend === 'webgpu') return surface.renderer.readPixels();
  const canvas = surface.canvas;
  if (!canvas) throw new TypeError('SVG requires a browser screenshot; it has no direct pixel buffer');
  return canvasPixels(canvas);
}

const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;

function measuredMetrics(latest, cpu, coldMs, gpuDone) {
  cpu.sort((left, right) => left - right);
  gpuDone.sort((left, right) => left - right);
  return {coldFrameMs: coldMs, cpuMedianMs: percentile(cpu, 0.5), cpuP95Ms: percentile(cpu, 0.95), cpuP99Ms: percentile(cpu, 0.99),
    gpuDoneMedianMs: percentile(gpuDone, 0.5), drawCalls: latest.drawCalls ?? null,
    gpuMemoryBytes: latest.totalGpuBytes ?? null, atlasBytes: latest.atlasBytes ?? null,
    renderTargetBytes: latest.renderTargetBytes ?? null, textureBytes: latest.textureBytes ?? null, bufferBytes: latest.bufferBytes ?? null,
    uploadedBytes: latest.uploadedBytes ?? null, sampleCount: latest.sampleCount ?? null,
    jsAllocationBytes: null, allocationPolicy: 'Not inferred from heap-size samples; deterministic allocation assertions use API tests'};
}

/** Keeps the rendered surface alive until screenshots finish; every subsequent fixture disposes the previous session. */
class ConformanceSession {
  constructor(container) { this.container = container; this.cleanup = []; this.running = false; }
  async dispose() {
    const errors = [];
    for (const close of this.cleanup.splice(0)) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Conformance fixture disposal failed');
  }
  async run({fixture: definition, backend = 'webgpu', tier = 'hardware', samples = 30, warmup = 10}) {
    if (this.running) throw new Error('A conformance fixture is already running');
    if (!Number.isInteger(samples) || samples < 1 || samples > 1000 || !Number.isInteger(warmup) || warmup < 0 || warmup > 1000) {
      throw new RangeError('Invalid conformance sample counts');
    }
    if (!['webgpu', 'canvas2d', 'dom'].includes(backend) || !['hardware', 'software'].includes(tier)) throw new TypeError('Invalid conformance backend/tier');
    this.running = true;
    try {
      await this.dispose();
      this.container.replaceChildren();
      return await this.render(definition, {backend, tier, samples, warmup});
    } finally { this.running = false; }
  }
  async render(definition, {backend, tier, samples, warmup}) {
    const coldStart = performance.now();
    const errors = [], metrics = [];
    const resources = new ResourceTable();
    const service = new GpuDevice({adapterOptions: {forceFallbackAdapter: tier === 'software'}});
    this.cleanup.push(() => resources.dispose(), () => service.dispose());
    await document.fonts?.ready;
    const fixture = await createFixture(definition, {document, resources, service, backend, container: this.container,
      onError: error => errors.push(String(error)), onMetrics: value => metrics.push(value)});
    this.cleanup.unshift(() => fixture.dispose());
    const surface = fixture.renderFrame ? null : new RenderSurface(this.container, {backend, deviceService: service, resources,
      textService: fixture.textService, backdropAvailable: !!definition.backdrop,
      blendColorSpace: definition.blendColorSpace ?? 'srgb',
      onError: error => errors.push(String(error)), onMetrics: value => metrics.push(value)});
    if (surface) { this.cleanup.unshift(() => surface.dispose()); await surface.ready; }
    const actual = () => surface?.backend ?? fixture.actualBackend();
    const frame = () => surface ? surface.draw() : fixture.renderFrame();
    const device = service.device;
    const uncaptured = event => errors.push(String(event.error));
    device?.addEventListener('uncapturederror', uncaptured);
    if (device) this.cleanup.unshift(() => device.removeEventListener('uncapturederror', uncaptured));
    device?.pushErrorScope('validation');
    let cpu, coldMs;
    try {
      if (surface) surface.updateDisplayList(fixture.list, resources, fixture.width, fixture.height, definition.dpr ?? 1);
      else frame();
      coldMs = performance.now() - coldStart;
      cpu = await this.sample(frame, {samples, warmup});
      await device?.queue.onSubmittedWorkDone();
    } finally {
      const validation = await device?.popErrorScope();
      if (validation) errors.push(String(validation));
    }
    const actualBackend = actual();
    const latest = surface ? metrics.at(-1) ?? {} : fixture.metrics();
    const pixels = surface && actualBackend !== 'dom' ? await readPixels(surface) : null;
    const verification = await fixture.verify?.(surface);
    const reference = await fixture.reference?.();
    const rect = (fixture.captureElement ?? surface?.canvas ?? surface?.domLayer ?? this.container).getBoundingClientRect();
    return {id: definition.id, status: errors.length ? 'failed' : actualBackend !== backend ? 'unavailable' : 'rendered',
      reason: surface?.reason ?? fixture.reason?.() ?? '', requested: backend, actualBackend, adapter: adapterDescription(service),
      usedBackends: fixture.usedBackends?.() ?? [actualBackend], captureMode: pixels ? 'retained-readback' : 'browser-composite',
      gallery: fixture.gallery ?? null, userAgent: navigator.userAgent, devicePixelRatio, errors, fallbacks: latest.fallbacks ?? [],
      captureRect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, viewport: {width: innerWidth, height: innerHeight},
      verification: verification ?? null,
      canvasReference: reference ? {kind: reference.kind, provider: reference.provider, glyphAccess: reference.glyphAccess, ...pixelPacket(reference)} : null,
      pixels: pixels ? pixelPacket(pixels) : null,
      metrics: measuredMetrics(latest, cpu, coldMs, metrics.map(value => value.gpuDoneMs).filter(Number.isFinite))};
  }
  async sample(frame, {samples, warmup}) {
    const cpu = [];
    for (let index = 0; index < warmup + samples; index++) {
      const start = performance.now();
      frame();
      const elapsed = performance.now() - start;
      if (index >= warmup) cpu.push(elapsed);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return cpu;
  }
}

const session = new ConformanceSession(document.getElementById('fixture'));
globalThis.renderingConformance = Object.freeze({run: options => session.run(options), dispose: () => session.dispose(), version: 1});
