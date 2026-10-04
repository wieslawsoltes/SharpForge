import {DrawingError} from '../drawing/commands.js';
import {BufferPool, TexturePool} from '../webgpu/pools.js';
import {TextureCache} from '../webgpu/texture-cache.js';
import {MeshBuilder} from '../webgpu/mesh-builder.js';
import {createVectorPipelines} from '../webgpu/pipelines.js';
import {GpuRenderPlan} from './webgpu-plan.js';
import {EffectPipeline} from '../webgpu/effect-pipeline.js';
import {probeRenderingCapabilities} from './negotiation.js';
import {AnalyticInstanceUpdates} from '../webgpu/instance-updates.js';
import {blendColorSpace, halfToNumber, encodeSrgbPixels} from '../media/working-color.js';
import {renderViewport} from './viewport.js';

/** Retained WebGPU renderer. Geometry, clips, text/images and isolated opacity execute on actual GPU passes. */
export class WebGpuBackend {
  constructor(canvas, service, {textService, onFallback = () => {}, sampleCount = 4, disabledOperations = [], blendColorSpace: workingSpace = 'srgb'} = {}) {
    this.canvas = canvas; this.service = service; this.textService = textService; this.fallbacks = [];
    service.pipelineCaches ??= {vector: new Map(), effect: new Map(), mipmap: new Map()};
    this.onFallback = entry => { this.fallbacks.push(entry); onFallback(entry); };
    this.sampleCount = sampleCount; this.device = null; this.backend = 'webgpu'; this.closed = false;
    this.colorSpace = blendColorSpace(workingSpace); this.targetFormat = workingSpace === 'linear' ? 'rgba16float' : 'rgba8unorm';
    this.bufferPool = new BufferPool(service); this.texturePool = new TexturePool(service, {maxBytes: 256 * 1024 * 1024});
    this.textures = new TextureCache(service); this.meshes = new MeshBuilder(this.textures, {textService, onFallback: this.onFallback,
      createCanvas: canvas.ownerDocument ? (width, height) => {
        const child = canvas.ownerDocument.createElement('canvas'); child.width = width; child.height = height; return child;
      } : null});
    this.uniformData = new Float32Array(4); this.plan = null; this.planKey = null; this.initializedEpoch = -1;
    this.disabledOperations = disabledOperations;
    this.frameRasters = new Set();
    this.ready = this.initialize();
  }
  async initialize() {
    const device = await this.service.acquire();
    if (this.closed) throw new DrawingError('SFRENDER099', 'GPU backend disposed during initialization');
    const epoch = this.service.epoch;
    const format = this.service.gpu.getPreferredCanvasFormat();
    const context = this.canvas.getContext('webgpu');
    if (!context) throw new DrawingError('SFRENDER100', 'WebGPU canvas context is unavailable');
    const pipelines = await createVectorPipelines(device, {format: this.targetFormat, presentationFormat: format, sampleCount: this.sampleCount,
      cache: this.service.pipelineCaches.vector});
    if (this.closed || epoch !== this.service.epoch) throw new DrawingError('SFRENDER099', 'GPU initialization superseded');
    this.device = device; this.context = context; this.pipelines = pipelines;
    context.configure({device, format, alphaMode: 'premultiplied', colorSpace: 'srgb'});
    this.uniform = device.createBuffer({label: 'SharpForge viewport', size: 16, usage: 64 | 8});
    this.sampler = device.createSampler({minFilter: 'linear', magFilter: 'linear'});
    this.effects = new EffectPipeline(this);
    await this.effects.ready;
    this.initializedEpoch = epoch;
    this.capabilities = probeRenderingCapabilities({deviceService: this.service, canvas: this.canvas, disabledOperations: this.disabledOperations});
    return this;
  }

  render(list, resources, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER099', 'GPU backend is disposed');
    if (!this.device || this.initializedEpoch !== this.service.epoch || this.service.state !== 'ready') {
      throw new DrawingError('SFRENDER101', 'GPU device is initializing or recovering');
    }
    const {width, height, dpr, pixelWidth, pixelHeight} = renderViewport(options,
      {maxDimension: this.device.limits?.maxTextureDimension2D ?? 8192});
    const resize = this.pixelWidth !== pixelWidth || this.pixelHeight !== pixelHeight;
    if (resize) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; }
    this.pixelWidth = pixelWidth; this.pixelHeight = pixelHeight;
    const revision = resources?.revision ?? resources?.version ?? options.resourceVersion ?? 0;
    const textVersion = options.textVersion ?? this.textService?.provider?.fontVersion ?? 0;
    options = {...options, textVersion};
    const viewportKey = `${width}:${height}:${dpr}:${this.service.epoch}:${textVersion}`, key = `${viewportKey}:${revision}`;
    let uploads = {uploadedBytes: 0, ranges: 0, changedInstances: 0};
    if (this.list !== list || this.planKey !== key) {
      if (this.plan && this.viewportKey === viewportKey && this.instanceUpdates?.update(list, resources)) uploads = this.instanceUpdates.lastUpload;
      else {
        this.instanceUpdates?.dispose(); this.instanceUpdates = null; this.plan?.dispose(); this.plan = null;
        this.uniformData[0] = width; this.uniformData[1] = height;
        this.uniformData[2] = this.colorSpace === 'linear' ? 1 : 0;
        this.device.queue.writeBuffer(this.uniform, 0, this.uniformData);
        this.fallbacks.length = 0;
        this.plan = new GpuRenderPlan(this, list, resources, {...options, width, height, dpr});
        this.instanceUpdates = AnalyticInstanceUpdates.create(this.plan, list, resources);
        uploads = {uploadedBytes: this.plan.buffers.reduce((sum, buffer) => sum + buffer.size, 0), ranges: this.plan.buffers.length, changedInstances: 0};
      }
      this.list = list; this.planKey = key;
      this.viewportKey = viewportKey;
    }
    const encoder = this.device.createCommandEncoder({label: 'SharpForge retained frame'});
    const metrics = {backend: 'webgpu', commands: list.commands.length, drawCalls: 0, sampleCount: this.sampleCount,
      pixelWidth, pixelHeight, textureBytes: this.textures.bytes, bufferBytes: this.bufferPool.bytes,
      renderTargetBytes: this.texturePool.bytes, atlasBytes: this.meshes.atlas?.bytes ?? 0,
      totalGpuBytes: this.bufferPool.bytes + this.texturePool.bytes + this.textures.bytes,
      adapter: this.service.adapter?.info ?? null, layerCacheHits: 0, layerRasterizations: 0,
      blendColorSpace: this.colorSpace, targetFormat: this.targetFormat, fallbacks: this.plan.fallbacks, ...uploads};
    this.frameRasters.clear();
    const preserve = !resize && options.clear === false && this.submittedPlan === this.plan;
    this.renderTarget(encoder, this.plan.root, metrics, preserve ? options.damage : null, preserve);
    const pass = encoder.beginRenderPass({colorAttachments: [{view: this.context.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: {r: 0, g: 0, b: 0, a: 0}}]});
    pass.setPipeline(this.pipelines.present); this.draw(pass, this.plan.presentation, metrics); pass.end();
    const ticket = this.service.submit([encoder.finish()]);
    for (const raster of this.frameRasters) raster.rendered = true;
    this.frameRasters.clear();
    this.plan.markSubmitted(ticket); this.service.retirement.use(this.uniform, ticket); this.ticket = ticket;
    this.submittedPlan = this.plan;
    return {...metrics, completion: ticket.done, submission: ticket.id};
  }

  renderTarget(encoder, target, metrics, damage = null, preserve = false) {
    let pass = null, stencil = 0, hasContents = preserve, firstPass = true;
    const begin = () => {
      const color = {view: target.colorView, loadOp: hasContents ? 'load' : 'clear', storeOp: 'store',
        clearValue: {r: 0, g: 0, b: 0, a: 0}};
      if (this.sampleCount > 1) color.resolveTarget = target.imageView;
      pass = encoder.beginRenderPass({colorAttachments: [color], depthStencilAttachment: {view: target.depthView,
        depthReadOnly: true, stencilLoadOp: firstPass ? 'clear' : 'load', stencilStoreOp: 'store', stencilClearValue: 0}});
      pass.setStencilReference(stencil);
      if (damage) {
        const scale = this.pixelWidth / this.uniformData[0], x = Math.max(0, Math.floor(damage[0] * scale));
        const y = Math.max(0, Math.floor(damage[1] * scale)), right = Math.min(this.pixelWidth, Math.ceil((damage[0] + damage[2]) * scale));
        const bottom = Math.min(this.pixelHeight, Math.ceil((damage[1] + damage[3]) * scale));
        pass.setScissorRect(x, y, Math.max(0, right - x), Math.max(0, bottom - y));
      }
      hasContents = true;
      firstPass = false;
    };
    begin();
    if (preserve && damage) { pass.setPipeline(this.pipelines.replace); this.draw(pass, this.plan.damageClear, metrics); }
    for (const command of target.commands) {
      if (command.kind === 'source' || command.kind === 'effect' || command.kind === 'backdrop') {
        pass.end();
        if (command.kind === 'source') this.renderTarget(encoder, command.target, metrics);
        else if (command.kind === 'effect') this.effects.render(encoder, command.program, metrics);
        else encoder.copyTextureToTexture({texture: target.image.resource}, {texture: command.image.resource}, [this.pixelWidth, this.pixelHeight]);
        begin();
      } else if (command.kind === 'layer') {
        pass.end();
        const raster = command.raster;
        if (raster?.rendered || this.frameRasters.has(raster)) metrics.layerCacheHits++;
        else {
          const backend = raster?.facade ?? this;
          backend.renderTarget(encoder, command.target, metrics);
          if (command.effectProgram) backend.effects.render(encoder, command.effectProgram, metrics);
          if (raster) { this.frameRasters.add(raster); metrics.layerRasterizations++; }
        }
        begin();
        pass.setPipeline(this.pipelines.draw); this.draw(pass, command.mesh, metrics);
      } else if (command.kind === 'clear') {
        pass.setPipeline(this.pipelines.clear); this.draw(pass, command.mesh, metrics);
      } else {
        const instanced = command.mesh?.kind === 'analytic' || command.mesh?.kind === 'glyph';
        const pipeline = command.kind === 'draw' && instanced ? command.mesh.kind : command.kind;
        pass.setPipeline(this.pipelines[pipeline]);
        pass.setStencilReference(stencil); if (command.mesh) this.draw(pass, command.mesh, metrics);
        if (command.kind === 'push') { if (++stencil > 255) throw new DrawingError('SFRENDER102', 'GPU stencil clip depth exceeded'); }
        else if (command.kind === 'pop') stencil--;
        pass.setStencilReference(stencil);
      }
    }
    pass.end();
  }
  draw(pass, mesh, metrics) {
    pass.setBindGroup(0, mesh.binding); pass.setVertexBuffer(0, mesh.buffer);
    if (mesh.kind === 'analytic' || mesh.kind === 'glyph') pass.draw(6, mesh.count); else pass.draw(mesh.count);
    metrics.drawCalls++;
  }
  async readPixels() {
    if (this.closed || !this.plan) throw new DrawingError('SFRENDER105', 'Render a live WebGPU target before reading pixels');
    const width = this.pixelWidth, height = this.pixelHeight, pixelBytes = this.colorSpace === 'linear' ? 8 : 4;
    const bytesPerRow = Math.ceil(width * pixelBytes / 256) * 256;
    const buffer = this.device.createBuffer({label: 'SharpForge conformance readback', size: bytesPerRow * height, usage: 1 | 8});
    try {
      const encoder = this.device.createCommandEncoder({label: 'SharpForge pixel readback'});
      encoder.copyTextureToBuffer({texture: this.plan.root.image.resource}, {buffer, bytesPerRow}, [width, height]);
      const ticket = this.service.submit([encoder.finish()]);
      this.service.retirement.use(this.plan.root.image.resource, ticket); this.service.retirement.use(buffer, ticket);
      await ticket.done; await buffer.mapAsync(1);
      const mapped = new Uint8Array(buffer.getMappedRange()), data = new Uint8Array(width * height * 4);
      if (this.colorSpace === 'linear') {
        const source = new DataView(mapped.buffer, mapped.byteOffset, mapped.byteLength), values = new Float32Array(data.length);
        for (let row = 0; row < height; row++) for (let channel = 0; channel < width * 4; channel++) {
          values[row * width * 4 + channel] = halfToNumber(source.getUint16(row * bytesPerRow + channel * 2, true));
        }
        encodeSrgbPixels(values, {premultiplied: true, output: data});
      } else for (let row = 0; row < height; row++) {
        data.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
      }
      buffer.unmap(); return {width, height, data, alphaMode: 'premultiplied'};
    } finally { this.service.retirement.retire(buffer); }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.instanceUpdates?.dispose(); this.plan?.dispose(); this.plan = null; this.textures.dispose(); this.meshes.dispose();
    this.layerRasters?.dispose();
    this.bufferPool.dispose(); this.texturePool.dispose(); this.context?.unconfigure?.();
    if (this.uniform) this.service.retirement.retire(this.uniform);
    this.device = null; this.pipelines = null;
  }
}
