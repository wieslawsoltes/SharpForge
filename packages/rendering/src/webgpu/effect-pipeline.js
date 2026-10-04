import {validateEffectGraph} from '../composition/effects.js';
import {effectShader} from './effect-shader.js';
import {DrawOp, DrawingError} from '../drawing/commands.js';
import {normalizeShadow} from '../brushes/shadows.js';
import {srgbToLinear} from '../media/colors.js';

const modes = {GaussianBlur: 0, Saturation: 2, Opacity: 3, Tint: 4, ColorSource: 5, Blend: 6, ArithmeticComposite: 7,
  Mask: 8, AcrylicDetails: 9, ShadowColor: 10};
async function sharedEffectPipeline(device, format, cache) {
  let formats = cache.get(device);
  if (!formats) { formats = new Map(); cache.set(device, formats); }
  if (!formats.has(format)) formats.set(format, createEffectPipeline(device, format));
  try { return await formats.get(format); } catch (error) { formats.delete(format); throw error; }
}

async function createEffectPipeline(device, format) {
  const module = device.createShaderModule({label: 'SharpForge composition effects', code: effectShader});
  const information = await module.getCompilationInfo?.();
  if (information?.messages.some(message => message.type === 'error')) throw new DrawingError('SFRENDER097',
    information.messages.filter(message => message.type === 'error').map(message => message.message).join('\n'));
  const layout = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: 2, buffer: {type: 'uniform'}},
    {binding: 1, visibility: 2, texture: {sampleType: 'float'}}, {binding: 2, visibility: 2, texture: {sampleType: 'float'}},
    {binding: 3, visibility: 2, sampler: {type: 'filtering'}}
  ]});
  const pipeline = await device.createRenderPipelineAsync({label: 'SharpForge fullscreen effect',
    layout: device.createPipelineLayout({bindGroupLayouts: [layout]}), vertex: {module, entryPoint: 'vs'},
    fragment: {module, entryPoint: 'fs', targets: [{format}]}, primitive: {topology: 'triangle-list'}});
  return {layout, pipeline};
}

/** Converts a validated effect DAG to actual render-to-texture stages; no CPU GPU readback. */
export class EffectPipeline {
  constructor(backend) { this.backend = backend; this.ready = this.initialize(); }
  async initialize() {
    Object.assign(this, await sharedEffectPipeline(this.backend.device, this.backend.targetFormat,
      this.backend.service.pipelineCaches?.effect ?? new Map()));
  }
  compile(graph, sources, plan, internal = false) {
    const normalized = internal ? graph : validateEffectGraph(graph), stages = [], cache = new Map();
    const sourceTexture = Object.values(sources)[0] ?? plan.root.image;
    const make = (node, inputs, mode) => {
      const {pixelWidth, pixelHeight, device} = this.backend;
      const target = this.backend.texturePool.acquire({size: [pixelWidth, pixelHeight], format: this.backend.targetFormat, usage: 4 | 16});
      const parameters = new Float32Array(12);
      parameters.set([pixelWidth, pixelHeight, mode,
        node.type === 'GaussianBlur' ? node.blurAmount * plan.options.dpr : node.noiseOpacity ?? node.saturation ?? node.opacity ??
          (node.type === 'Blend' ? ['SourceOver', 'Multiply', 'Screen', 'Add'].indexOf(node.mode) : 0)]);
      parameters.set(node.color ?? [1, 1, 1, 1], 4); parameters.set(node.coefficients ?? [0, 1, 0, 0], 8);
      if (this.backend.colorSpace === 'linear') for (let channel = 4; channel < 7; channel++) parameters[channel] = srgbToLinear(parameters[channel]);
      plan.effectTextures.push(target);
      const uniform = this.backend.bufferPool.acquire(48, 64 | 8); plan.buffers.push(uniform);
      device.queue.writeBuffer(uniform.resource, 0, parameters);
      const first = inputs[0] ?? sourceTexture, second = inputs[1] ?? first;
      const binding = device.createBindGroup({layout: this.layout, entries: [
        {binding: 0, resource: {buffer: uniform.resource}}, {binding: 1, resource: first.resource.createView()},
        {binding: 2, resource: second.resource.createView()}, {binding: 3, resource: this.backend.sampler}
      ]});
      stages.push({target, binding}); return target;
    };
    const visit = node => {
      if (cache.has(node)) return cache.get(node);
      if (node.type === 'Source') {
        if (!sources[node.name]) throw new DrawingError('SFRENDER103', `Missing GPU effect source ${node.name}`);
        return sources[node.name];
      }
      const inputs = (node.sources ?? []).map(visit);
      let result = make(node, inputs, modes[node.type]);
      if (node.type === 'GaussianBlur') result = make(node, [result], 1);
      cache.set(node, result); return result;
    };
    return {output: visit(normalized), stages};
  }
  mask(source, mask, plan) {
    return this.compile({type: 'Mask', sources: [{type: 'Source', name: 'source'}, {type: 'Source', name: 'mask'}]},
      {source, mask}, plan, true);
  }
  acrylicDetails(source, brush, plan) {
    return this.compile({type: 'AcrylicDetails', color: brush.tint, noiseOpacity: brush.noiseOpacity,
      coefficients: [brush.luminosityOpacity, 0, 0, 0], sources: [{type: 'Source', name: 'source'}]}, {source}, plan, true);
  }
  layer(source, layer, plan, description) {
    let program = layer.effect ? this.compile(layer.effect, {Source: source, source}, plan) : null;
    if (!layer.shadow) return program;
    const shadow = this.shadow(program?.output ?? source, layer.shadow, plan, description);
    if (program) shadow.stages.unshift(...program.stages);
    return shadow;
  }
  shadow(source, input, plan, {bounds, contentBounds = bounds}) {
    const shadow = normalizeShadow(input), prepare = [];
    let mask = source;
    if (shadow.mask) {
      const target = plan.target();
      target.commands = plan.compile([{op: DrawOp.Rectangle, rect: contentBounds, brush: shadow.mask}],
        [1, 0, 0, 1, -bounds[0], -bounds[1]]);
      prepare.push(target); mask = target.image;
    }
    const color = [...shadow.color]; color[3] *= shadow.opacity;
    const silhouette = shadow.blurRadius ? {type: 'GaussianBlur', blurAmount: shadow.blurRadius,
      sources: [{type: 'Source', name: 'mask'}]} : {type: 'Source', name: 'mask'};
    const graph = {type: 'Blend', mode: 'SourceOver', sources: [{type: 'Source', name: 'source'},
      {type: 'ShadowColor', color, coefficients: [shadow.offset[0] * plan.options.dpr, shadow.offset[1] * plan.options.dpr, 0, 0],
        sources: [silhouette]}]};
    return {...this.compile(graph, {source, mask}, plan, true), prepare};
  }
  render(encoder, program, metrics) {
    for (const target of program.prepare ?? []) this.backend.renderTarget(encoder, target, metrics);
    for (const stage of program.stages) {
      const pass = encoder.beginRenderPass({colorAttachments: [{view: stage.target.resource.createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: {r: 0, g: 0, b: 0, a: 0}}]});
      pass.setPipeline(this.pipeline); pass.setBindGroup(0, stage.binding); pass.draw(3); pass.end(); metrics.drawCalls++;
    }
  }
}
