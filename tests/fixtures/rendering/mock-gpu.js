import {createRecordingDocument} from './recording-canvas.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function live(resource) {
  if (!resource || resource.destroyed) throw new Error('Mock GPU use after destruction');
}

function dimensions(size) {
  return Array.isArray(size) ? [size[0], size[1] ?? 1, size[2] ?? 1]
    : [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1];
}

class Buffer {
  constructor(device, descriptor) {
    this.device = device;
    this.descriptor = descriptor;
    this.size = descriptor.size;
    this.bytes = new Uint8Array(this.size);
    this.destroyed = false;
    this.destroyCount = 0;
    this.mapped = false;
  }
  destroy() { this.destroyCount++; this.destroyed = true; }
  async mapAsync() { live(this); this.mapped = true; }
  getMappedRange() { live(this); if (!this.mapped) throw new Error('Mock GPU buffer is not mapped'); return this.bytes.buffer; }
  unmap() { this.mapped = false; }
}

class Texture {
  constructor(device, descriptor, external = false) {
    this.device = device;
    this.descriptor = descriptor;
    [this.width, this.height] = dimensions(descriptor.size);
    this.format = descriptor.format;
    this.destroyed = false;
    this.destroyCount = 0;
    this.external = external;
  }
  createView(descriptor = {}) { live(this); return {texture: this, descriptor}; }
  destroy() { this.destroyCount++; this.destroyed = true; }
}

class Pass {
  constructor(encoder, descriptor) {
    this.encoder = encoder;
    this.descriptor = descriptor;
    this.commands = [];
    this.ended = false;
    for (const attachment of descriptor.colorAttachments) {
      encoder.reference(attachment.view.texture);
      if (attachment.resolveTarget) encoder.reference(attachment.resolveTarget.texture);
    }
    if (descriptor.depthStencilAttachment) encoder.reference(descriptor.depthStencilAttachment.view.texture);
  }
  setPipeline(pipeline) { this.pipeline = pipeline; this.commands.push({kind: 'pipeline', pipeline}); }
  setBindGroup(index, group) {
    for (const entry of group.descriptor.entries) {
      const resource = entry.resource.buffer ?? entry.resource.texture;
      if (resource) this.encoder.reference(resource);
    }
    this.commands.push({kind: 'binding', index, group});
  }
  setVertexBuffer(index, buffer) { this.encoder.reference(buffer); this.commands.push({kind: 'buffer', index, buffer}); }
  setStencilReference(value) { this.commands.push({kind: 'stencil', value}); }
  setScissorRect(...value) { this.commands.push({kind: 'scissor', value}); }
  draw(vertices, instances = 1) {
    if (!this.pipeline || this.ended) throw new Error('Mock GPU draw requires a live pass and pipeline');
    this.commands.push({kind: 'draw', vertices, instances, pipeline: this.pipeline});
  }
  end() { if (this.ended) throw new Error('Mock GPU render pass ended twice'); this.ended = true; }
}

class Encoder {
  constructor(device, descriptor) {
    this.device = device;
    this.descriptor = descriptor;
    this.passes = [];
    this.copies = [];
    this.references = new Set();
  }
  reference(value) { live(value); this.references.add(value); }
  beginRenderPass(descriptor) {
    const pass = new Pass(this, descriptor);
    this.passes.push(pass);
    return pass;
  }
  copyTextureToTexture(source, destination, size) {
    this.reference(source.texture);
    this.reference(destination.texture);
    this.copies.push({kind: 'texture', source, destination, size});
  }
  copyTextureToBuffer(source, destination, size) {
    this.reference(source.texture);
    this.reference(destination.buffer);
    this.copies.push({kind: 'readback', source, destination, size});
  }
  finish() {
    if (this.passes.some(pass => !pass.ended)) throw new Error('Mock GPU command buffer has an open render pass');
    return this;
  }
}

class Queue {
  constructor(device, autoComplete) {
    this.device = device;
    this.autoComplete = autoComplete;
    this.writes = [];
    this.textureWrites = [];
    this.submissions = [];
    this.pending = [];
  }
  writeBuffer(buffer, offset, data, dataOffset = 0, size) {
    live(buffer);
    const unit = data.BYTES_PER_ELEMENT ?? 1;
    const source = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const start = dataOffset * unit, count = size === undefined ? source.byteLength - start : size * unit;
    if (offset % 4 || start < 0 || count % 4 || start + count > source.length || offset + count > buffer.size) {
      throw new RangeError('Mock GPU writeBuffer range or alignment');
    }
    const bytes = source.slice(start, start + count);
    buffer.bytes.set(bytes, offset);
    this.writes.push({buffer, offset, bytes});
  }
  writeTexture(destination, data, layout, size) {
    live(destination.texture);
    this.textureWrites.push({destination, data: data.slice(), layout, size});
  }
  copyExternalImageToTexture(source, destination, size) {
    live(destination.texture);
    if (!source.source) throw new Error('Mock GPU external image is missing');
    this.textureWrites.push({source, destination, size});
  }
  submit(commands) {
    for (const command of commands) for (const resource of command.references) live(resource);
    const completion = deferred();
    this.submissions.push({commands, completion});
    this.pending.push(completion);
    if (this.autoComplete) this.complete();
  }
  onSubmittedWorkDone() {
    return Promise.all(this.pending.map(entry => entry.promise)).then(() => undefined);
  }
  complete() { for (const entry of this.pending.splice(0)) entry.resolve(); }
}

class Device {
  constructor(options) {
    this.options = options;
    this.buffers = [];
    this.textures = [];
    this.pipelines = [];
    this.encoders = [];
    this.modules = [];
    this.features = new Set();
    this.limits = {maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxVertexAttributes: 16, ...options.limits};
    this.queue = new Queue(this, options.autoComplete ?? true);
    this.loss = deferred();
    this.lost = this.loss.promise;
    this.destroyCount = 0;
  }
  createBuffer(descriptor) { const value = new Buffer(this, descriptor); this.buffers.push(value); return value; }
  createTexture(descriptor) { const value = new Texture(this, descriptor); this.textures.push(value); return value; }
  createSampler(descriptor) { return {descriptor}; }
  createBindGroupLayout(descriptor) { return {descriptor}; }
  createPipelineLayout(descriptor) { return {descriptor}; }
  createBindGroup(descriptor) { return {descriptor}; }
  createShaderModule(descriptor) {
    const module = {descriptor, getCompilationInfo: async () => ({messages: this.options.compilationErrors ?? []})};
    this.modules.push(module);
    return module;
  }
  async createRenderPipelineAsync(descriptor) {
    if (this.options.pipelineError) throw this.options.pipelineError;
    const pipeline = {descriptor, getBindGroupLayout: () => descriptor.layout};
    this.pipelines.push(pipeline);
    return pipeline;
  }
  createRenderPipeline(descriptor) {
    const pipeline = {descriptor, getBindGroupLayout: () => descriptor.layout};
    this.pipelines.push(pipeline);
    return pipeline;
  }
  createCommandEncoder(descriptor = {}) { const encoder = new Encoder(this, descriptor); this.encoders.push(encoder); return encoder; }
  pushErrorScope() {}
  async popErrorScope() { return null; }
  addEventListener() {}
  removeEventListener() {}
  destroy() { this.destroyCount++; this.loss.resolve({reason: 'destroyed', message: 'Mock device destroyed'}); }
  lose(message = 'Mock device lost') { this.loss.resolve({reason: 'unknown', message}); }
}

/** Explicit API-only device fixture; real shader compilation, pixels and adapter qualification use the browser runner. */
export function createMockGpu(options = {}) {
  const devices = [], requests = [];
  const adapter = {info: {vendor: 'SharpForge test double', device: 'api-recorder', isFallbackAdapter: true},
    requestDevice: async descriptor => {
      const device = new Device(options);
      device.requestDescriptor = descriptor;
      devices.push(device);
      return device;
    }};
  const gpu = {requestAdapter: async descriptor => { requests.push(descriptor); return options.unavailable ? null : adapter; },
    getPreferredCanvasFormat: () => options.format ?? 'bgra8unorm'};
  const document = createRecordingDocument(canvas => ({configuration: null, unconfigured: false,
    configure(value) { this.configuration = value; }, unconfigure() { this.unconfigured = true; },
    getCurrentTexture() {
      if (!this.configuration) throw new Error('Mock GPU canvas is not configured');
      return new Texture(this.configuration.device, {size: [canvas.width, canvas.height], format: this.configuration.format}, true);
    }}));
  return {gpu, adapter, devices, requests, document, createCanvas: () => document.createElement('canvas')};
}
