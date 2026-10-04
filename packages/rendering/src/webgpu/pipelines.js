import {vectorShader, vertexLayout, premultipliedBlend} from './vector-shader.js';
import {DrawingError} from '../drawing/commands.js';
import {analyticShader, analyticInstanceLayout} from './analytic-shader.js';
import {glyphShader, glyphInstanceLayout} from './glyph-shader.js';

/** Pipeline state is per-device, immutable and shared across all surface command lists. */
export async function createVectorPipelines(device, {format = 'rgba8unorm', presentationFormat, sampleCount = 4, cache = new Map()} = {}) {
  let entries = cache.get(device);
  if (!entries) { entries = new Map(); cache.set(device, entries); }
  const key = `${format}:${presentationFormat ?? format}:${sampleCount}`;
  if (!entries.has(key)) entries.set(key, buildVectorPipelines(device, {format, presentationFormat, sampleCount}));
  try { return await entries.get(key); } catch (error) { entries.delete(key); throw error; }
}

async function buildVectorPipelines(device, {format, presentationFormat, sampleCount}) {
  const module = device.createShaderModule({label: 'SharpForge retained vectors/images/glyphs', code: vectorShader});
  const information = await module.getCompilationInfo?.();
  const errors = information?.messages.filter(message => message.type === 'error') ?? [];
  if (errors.length) throw new DrawingError('SFRENDER097', errors.map(error => error.message).join('\n'));
  const analyticModule = device.createShaderModule({label: 'SharpForge analytic instances', code: analyticShader});
  const analyticInformation = await analyticModule.getCompilationInfo?.();
  const analyticErrors = analyticInformation?.messages.filter(message => message.type === 'error') ?? [];
  if (analyticErrors.length) throw new DrawingError('SFRENDER097', analyticErrors.map(error => error.message).join('\n'));
  const glyphModule = device.createShaderModule({label: 'SharpForge instanced glyph atlas', code: glyphShader});
  const glyphInformation = await glyphModule.getCompilationInfo?.();
  const glyphErrors = glyphInformation?.messages.filter(message => message.type === 'error') ?? [];
  if (glyphErrors.length) throw new DrawingError('SFRENDER097', glyphErrors.map(error => error.message).join('\n'));
  const layout = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: 3, buffer: {type: 'uniform'}},
    {binding: 1, visibility: 2, texture: {sampleType: 'float'}},
    {binding: 2, visibility: 2, sampler: {type: 'filtering'}}
  ]});
  const pipelineLayout = device.createPipelineLayout({bindGroupLayouts: [layout]});
  const create = (mode, targetFormat = format, samples = sampleCount) => {
    const shader = mode === 'analytic' ? analyticModule : mode === 'glyph' ? glyphModule : module;
    const vertices = mode === 'analytic' ? analyticInstanceLayout : mode === 'glyph' ? glyphInstanceLayout : vertexLayout;
    const stencil = mode === 'present' ? undefined : {format: 'depth24plus-stencil8', depthWriteEnabled: false, depthCompare: 'always',
      stencilFront: {compare: mode === 'replace' ? 'always' : 'equal', failOp: 'keep', depthFailOp: 'keep',
        passOp: mode === 'push' ? 'increment-clamp' : mode === 'pop' ? 'decrement-clamp' : 'keep'},
      stencilBack: {compare: mode === 'replace' ? 'always' : 'equal', failOp: 'keep', depthFailOp: 'keep',
        passOp: mode === 'push' ? 'increment-clamp' : mode === 'pop' ? 'decrement-clamp' : 'keep'},
      stencilReadMask: 255, stencilWriteMask: mode === 'push' || mode === 'pop' ? 255 : 0};
    const descriptor = {label: `SharpForge ${mode}`, layout: pipelineLayout,
      vertex: {module: shader, entryPoint: 'vs', buffers: [vertices]},
      fragment: {module: shader, entryPoint: mode === 'present' ? 'fsPresent' : 'fs', targets: [{format: targetFormat,
        ...(mode === 'replace' || mode === 'clear' ? {} : {blend: premultipliedBlend}),
        writeMask: mode === 'push' || mode === 'pop' ? 0 : 15}]}, primitive: {topology: 'triangle-list'},
      multisample: {count: samples}};
    if (stencil) descriptor.depthStencil = stencil;
    return device.createRenderPipelineAsync(descriptor);
  };
  const [draw, push, pop, present, analytic, glyph, replace, clear] = await Promise.all([create('draw'), create('push'), create('pop'),
    create('present', presentationFormat ?? format, 1), create('analytic'), create('glyph'), create('replace'), create('clear')]);
  return {layout, draw, push, pop, present, analytic, glyph, replace, clear, sampleCount, format};
}
