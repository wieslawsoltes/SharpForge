const shader = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Vertex {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var output: Vertex; output.position = vec4f(positions[index], 0, 1);
  output.uv = positions[index] * vec2f(0.5, -0.5) + vec2f(0.5); return output;
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f { return textureSample(source, sourceSampler, input.uv); }
`;

export function mipLayout(width, height, enabled = true) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 16384)) throw new RangeError('Invalid mip dimensions');
  const levels = []; let bytes = 0;
  do { levels.push([width, height]); bytes += width * height * 4;
    if (!enabled || width === 1 && height === 1) break;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
  } while (true);
  return {levels, bytes};
}

/** Each mip samples the previous premultiplied level, so transparent image borders remain fringe-free. */
export function generateMipmaps(service, texture, levels) {
  if (levels.length < 2) return null;
  const device = service.device;
  const cache = service.pipelineCaches?.mipmap ?? new Map();
  let state = cache.get(device);
  if (!state) {
    const module = device.createShaderModule({label: 'SharpForge premultiplied mip generation', code: shader});
    const pipeline = device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'},
      fragment: {module, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}, primitive: {topology: 'triangle-list'}});
    state = {pipeline, sampler: device.createSampler({minFilter: 'linear', magFilter: 'linear'})}; cache.set(device, state);
  }
  const encoder = device.createCommandEncoder({label: 'SharpForge image mip chain'});
  for (let level = 1; level < levels.length; level++) {
    const binding = device.createBindGroup({layout: state.pipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: texture.createView({baseMipLevel: level - 1, mipLevelCount: 1})}, {binding: 1, resource: state.sampler}
    ]});
    const pass = encoder.beginRenderPass({colorAttachments: [{view: texture.createView({baseMipLevel: level, mipLevelCount: 1}),
      loadOp: 'clear', storeOp: 'store', clearValue: {r: 0, g: 0, b: 0, a: 0}}]});
    pass.setPipeline(state.pipeline); pass.setBindGroup(0, binding); pass.draw(3); pass.end();
  }
  const ticket = service.submit([encoder.finish()]); service.retirement.use(texture, ticket); return ticket;
}
