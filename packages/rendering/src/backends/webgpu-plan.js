import {DrawOp, DrawingError, resolveResource} from '../drawing/commands.js';
import {IDENTITY, multiply} from '../media/transforms.js';
import {parseColor} from '../media/colors.js';
import {normalizeGeometry} from '../geometry/path-geometry.js';
import {flattenGeometry} from '../geometry/geometry-math.js';
import {tessellateFill} from '../geometry/tessellation.js';
import {quadTriangles} from '../webgpu/mesh-builder.js';
import {prepareGpuBrush} from '../webgpu/brush-plan.js';
import {GpuLayerRasters} from '../webgpu/layer-rasters.js';
import {analyticInstance} from '../webgpu/analytic-instances.js';
import {drawingOperationClass, selectOperationBackend} from './negotiation.js';
import {rasterOperation} from './operation-raster.js';
import {glyphInstanceFloats} from '../webgpu/glyph-shader.js';

/** Immutable GPU plan preserves painter order, batching only adjacent draws with compatible resources. */
export class GpuRenderPlan {
  constructor(backend, list, resources, options) {
    this.backend = backend; this.resources = resources; this.options = options; this.buffers = []; this.targets = []; this.effectTextures = [];
    this.cachedLayers = new Set();
    this.layerRasters = backend.layerRasters ??= new GpuLayerRasters(backend);
    this.textures = new Set(); this.pinnedTextures = new Set(); this.atlasPages = new Set(); this.bindings = new Map(); this.commands = 0;
    const previous = backend.textures.pinTarget; backend.textures.pinTarget = this;
    const fallbackStart = backend.fallbacks.length;
    try {
      this.root = this.target(); this.root.commands = this.compile(list.commands, IDENTITY);
      this.presentation = this.rasterQuad(this.root.image, 1);
      this.damageClear = this.colorQuad([0, 0, 0, 0]);
      this.fallbacks = backend.fallbacks.slice(fallbackStart);
    } catch (error) { this.dispose(); throw error; }
    finally { backend.textures.pinTarget = previous; }
  }
  pinTexture(texture) {
    if (!this.pinnedTextures.has(texture)) { this.pinnedTextures.add(texture); this.backend.textures.retain(texture); }
  }
  pinAtlas(page) { if (!this.atlasPages.has(page)) { this.atlasPages.add(page); page.pins++; } }
  target() {
    const {pixelWidth, pixelHeight} = this.backend, pool = this.backend.texturePool, samples = this.backend.sampleCount;
    const leases = [], format = this.backend.targetFormat;
    const acquire = descriptor => { const lease = pool.acquire(descriptor); leases.push(lease); return lease; };
    try {
      const image = acquire({size: [pixelWidth, pixelHeight], format, usage: 4 | 16 | 1 | 2});
      const multisample = samples > 1 ? acquire({size: [pixelWidth, pixelHeight], format, usage: 16, sampleCount: samples}) : image;
      const depth = acquire({size: [pixelWidth, pixelHeight], format: 'depth24plus-stencil8', usage: 16, sampleCount: samples});
      const target = {image, multisample, depth, imageView: image.resource.createView(),
        colorView: multisample.resource.createView(), depthView: depth.resource.createView(), commands: []};
      this.targets.push(target); return target;
    } catch (error) { for (const lease of leases) pool.release(lease); throw error; }
  }
  upload(mesh) {
    const lease = this.backend.bufferPool.acquire(mesh.data.byteLength || 4, 32 | 8);
    this.buffers.push(lease); this.textures.add(mesh.texture);
    this.backend.device.queue.writeBuffer(lease.resource, 0, mesh.data);
    return {...mesh, buffer: lease.resource, binding: this.binding(mesh.texture)};
  }
  binding(texture) {
    let group = this.bindings.get(texture);
    if (!group) {
      group = this.backend.device.createBindGroup({layout: this.backend.pipelines.layout, entries: [
        {binding: 0, resource: {buffer: this.backend.uniform}}, {binding: 1, resource: texture.view}, {binding: 2, resource: texture.sampler}
      ]});
      this.bindings.set(texture, group);
    }
    return group;
  }
  rasterQuad(imageLease, opacity) {
    const texture = {texture: imageLease.resource, view: imageLease.resource.createView(), sampler: this.backend.sampler};
    const {width, height} = this.options;
    const mesh = this.backend.meshes.vertices(quadTriangles([0, 0, width, height]), {texture, color: [1, 1, 1, opacity],
      paint: [0, 0, 0, 1], uv: point => [point[0] / width, point[1] / height]}, IDENTITY);
    return this.upload(mesh);
  }
  colorQuad(color) {
    const paint = this.backend.meshes.paint(color, [0, 0, this.options.width, this.options.height], this.resources, this.options);
    return this.upload(this.backend.meshes.vertices(quadTriangles([0, 0, this.options.width, this.options.height]), paint, IDENTITY));
  }
  compile(commands, initialTransform, brushDepth = 0, layerDepth = this.options.layerDepth ?? 0) {
    if (layerDepth > 64) throw new DrawingError('SFRENDER130', 'GPU layer nesting budget exceeded');
    const output = [], stack = [];
    let transform = initialTransform, pending = [], pendingTexture = null, pendingKind = 'vector', totalFloats = 0;
    const flush = () => {
      if (!pending.length) return;
      const data = new Float32Array(totalFloats);
      let offset = 0;
      for (const mesh of pending) { data.set(mesh.data, offset); offset += mesh.data.length; }
      const stride = pendingKind === 'analytic' ? 32 : pendingKind === 'glyph' ? glyphInstanceFloats : 12;
      output.push({kind: 'draw', mesh: this.upload({data, count: totalFloats / stride,
        texture: pendingTexture, kind: pendingKind})});
      pending = []; pendingTexture = null; totalFloats = 0;
    };
    for (let index = 0; index < commands.length; index++) {
      const command = commands[index]; this.commands++;
      if (command.op === DrawOp.PushTransform) { stack.push({kind: 'transform', transform}); transform = multiply(transform, command.transform); continue; }
      if (command.op !== DrawOp.Pop && command.op !== DrawOp.Clear) {
        const operation = drawingOperationClass(command), selected = selectOperationBackend(operation, this.backend.capabilities, 'webgpu');
        if (selected.backend !== 'webgpu') {
          flush(); let end = index + 1;
          if (command.op === DrawOp.PushClip || command.op === DrawOp.PushOpacity) {
            let depth = 1;
            for (; end < commands.length && depth; end++) {
              if ([DrawOp.PushTransform, DrawOp.PushClip, DrawOp.PushOpacity].includes(commands[end].op)) depth++;
              else if (commands[end].op === DrawOp.Pop) depth--;
            }
            if (depth) throw new DrawingError('SFRENDER011', 'Fallback operation group is unbalanced');
          }
          for (const mesh of rasterOperation(this.backend, commands.slice(index, end), transform, this.resources, this.options,
            {operation, ...selected})) output.push({kind: 'draw', mesh: this.upload(mesh)});
          index = end - 1; continue;
        }
      }
      if (command.op === DrawOp.PushClip) {
        flush();
        const geometry = normalizeGeometry(resolveResource(this.resources, command.geometry, 'geometry'), this.options.resolve);
        const triangles = tessellateFill(flattenGeometry(geometry, {tolerance: 0.15 / this.options.dpr}), geometry.fillRule ?? 'evenodd');
        const paint = this.backend.meshes.paint('#ffffff', [0, 0, 1, 1], this.resources, this.options);
        const mesh = this.backend.meshes.vertices(triangles, paint, transform);
        const uploaded = mesh ? this.upload(mesh) : null;
        stack.push({kind: 'clip', mesh: uploaded, transform}); output.push({kind: 'push', mesh: uploaded}); continue;
      }
      if (command.op === DrawOp.PushOpacity) {
        flush(); let depth = 1, end = index + 1;
        for (; end < commands.length && depth; end++) {
          if ([DrawOp.PushTransform, DrawOp.PushClip, DrawOp.PushOpacity].includes(commands[end].op)) depth++;
          else if (commands[end].op === DrawOp.Pop) depth--;
        }
        if (depth) throw new DrawingError('SFRENDER011', 'Unbalanced opacity layer');
        const target = this.target(); target.commands = this.compile(commands.slice(index + 1, end - 1), transform, brushDepth, layerDepth + 1);
        output.push({kind: 'layer', target, mesh: this.rasterQuad(target.image, command.opacity)}); index = end - 1; continue;
      }
      if (command.op === DrawOp.Pop) {
        const previous = stack.pop();
        if (!previous) throw new DrawingError('SFRENDER010', 'GPU drawing stack underflow');
        if (previous.kind === 'clip') { flush(); output.push({kind: 'pop', mesh: previous.mesh}); }
        transform = previous.transform; continue;
      }
      if (command.op === DrawOp.Clear) {
        flush(); const color = parseColor(command.color); output.push({kind: 'clear', color, mesh: this.colorQuad(color)}); continue;
      }
      if (command.op === DrawOp.Layer) {
        flush(); const layer = resolveResource(this.resources, command.layer, 'layer');
        if (!layer?.displayList) throw new DrawingError('SFRENDER093', 'GPU layer requires a retained display list');
        const layerTransform = command.options?.transform ?? layer.transform ?? IDENTITY;
        const effect = command.options?.effect ?? layer.effect, shadow = command.options?.shadow ?? layer.shadow;
        const raster = this.layerRasters.acquire({...layer, effect, shadow}, this.resources, {...this.options, layerDepth: layerDepth + 1},
          (backend, list, resources, options) => new GpuRenderPlan(backend, list, resources, options));
        if (!raster) {
          const target = this.target();
          target.commands = this.compile(layer.displayList.commands, multiply(transform, layerTransform), brushDepth, layerDepth + 1);
          const effectProgram = this.backend.effects.layer(target.image, {effect, shadow}, this,
            {bounds: [0, 0, this.options.width, this.options.height]});
          output.push({kind: 'layer', target, mesh: this.rasterQuad(effectProgram?.output ?? target.image,
            command.options?.opacity ?? layer.opacity ?? 1), effectProgram});
          continue;
        }
        this.layerRasters.pin(this, raster);
        this.backend.fallbacks.push(...raster.plan.fallbacks);
        output.push({kind: 'layer', target: raster.plan.root, raster,
          mesh: this.cachedLayerQuad(raster, multiply(transform, layerTransform), command.options?.opacity ?? layer.opacity ?? 1),
          effectProgram: raster.program});
        continue;
      }
      let meshes;
      const analytic = this.backend.capabilities.operations.analytic ?
        analyticInstance(command, transform, this.resources, this.options, this.backend.meshes.whiteTexture()) : null;
      if (analytic) meshes = analytic.count ? [analytic] : [];
      if (!meshes && [DrawOp.Rectangle, DrawOp.RoundedRectangle, DrawOp.Ellipse, DrawOp.Line, DrawOp.Geometry].includes(command.op)) {
        const geometry = this.backend.meshes.geometry(command, this.resources, this.options), prepared = [];
        const fill = prepareGpuBrush(this, command.brush, geometry.bounds, transform, prepared, brushDepth);
        const stroke = prepareGpuBrush(this, geometry.pen?.brush, geometry.bounds, transform, prepared, brushDepth);
        if (prepared.length) {
          flush(); output.push(...prepared); meshes = [];
          if (geometry.fill) meshes.push(this.backend.meshes.vertices(geometry.fill,
            fill ?? this.backend.meshes.paint(command.brush, geometry.bounds, this.resources, this.options), transform));
          if (geometry.stroke) meshes.push(this.backend.meshes.vertices(geometry.stroke,
            stroke ?? this.backend.meshes.paint(geometry.pen.brush, geometry.bounds, this.resources, this.options), transform));
          meshes = meshes.filter(Boolean);
        }
      }
      meshes ??= this.backend.meshes.build(command, transform, this.resources, {...this.options, plan: this});
      for (const mesh of meshes) {
        const limit = Math.min(this.backend.device.limits?.maxBufferSize ?? 134217728, 67108864) / 4;
        if (pendingTexture !== mesh.texture || pendingKind !== (mesh.kind ?? 'vector') || totalFloats + mesh.data.length > limit) flush();
        if (mesh.data.length > limit) throw new DrawingError('SFRENDER098', 'A single tessellated command exceeds the GPU buffer limit');
        pending.push(mesh); pendingTexture = mesh.texture; pendingKind = mesh.kind ?? 'vector'; totalFloats += mesh.data.length;
      }
    }
    flush();
    if (stack.length) throw new DrawingError('SFRENDER011', 'GPU drawing stack is unbalanced');
    return output;
  }

  cachedLayerQuad(raster, transform, opacity) {
    const image = raster.image;
    const texture = {texture: image.resource, view: image.resource.createView(), sampler: this.backend.sampler};
    const bounds = raster.description.bounds;
    const mesh = this.backend.meshes.vertices(quadTriangles(bounds), {texture, color: [1, 1, 1, opacity],
      paint: [0, 0, 0, 1], uv: point => [(point[0] - bounds[0]) / bounds[2], (point[1] - bounds[1]) / bounds[3]]}, transform);
    return this.upload(mesh);
  }

  markSubmitted(ticket) {
    this.ticket = ticket;
    for (const layer of this.cachedLayers) this.layerRasters.submitted(layer, ticket);
    for (const lease of this.buffers) this.backend.service.retirement.use(lease.resource, ticket);
    for (const target of this.targets) {
      this.backend.service.retirement.use(target.image.resource, ticket);
      this.backend.service.retirement.use(target.multisample.resource, ticket);
      this.backend.service.retirement.use(target.depth.resource, ticket);
    }
    for (const texture of this.textures) this.backend.service.retirement.use(texture.texture, ticket);
    for (const texture of this.effectTextures) this.backend.service.retirement.use(texture.resource, ticket);
  }
  dispose() {
    for (const layer of this.cachedLayers) this.layerRasters.release(layer);
    this.cachedLayers.clear();
    for (const texture of this.pinnedTextures) this.backend.textures.release(texture);
    this.pinnedTextures.clear();
    for (const page of this.atlasPages) page.pins--;
    this.atlasPages.clear();
    for (const lease of this.buffers) this.backend.bufferPool.release(lease, this.ticket);
    for (const target of this.targets) {
      this.backend.texturePool.release(target.image, this.ticket);
      if (target.multisample !== target.image) this.backend.texturePool.release(target.multisample, this.ticket);
      this.backend.texturePool.release(target.depth, this.ticket);
    }
    for (const texture of this.effectTextures) this.backend.texturePool.release(texture, this.ticket);
    this.effectTextures.length = 0;
    this.buffers.length = 0; this.targets.length = 0;
  }
}
