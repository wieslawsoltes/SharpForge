import {colorShader} from './color-shader.js';

/** Atlas coverage and intrinsic color glyphs use the same declared working-color policy as retained vectors. */
export const glyphShader = `
${colorShader}
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlasSampler: sampler;
struct Instance {
  @location(0) rect: vec4f,
  @location(1) uv: vec4f,
  @location(2) color: vec4f,
  @location(3) matrix: vec4f,
  @location(4) placement: vec4f,
};
struct Fragment {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) intrinsicColor: f32,
};
@vertex fn vs(input: Instance, @builtin(vertex_index) vertex: u32) -> Fragment {
  let corners = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let corner = corners[vertex];
  let local = input.rect.xy + corner * input.rect.zw;
  let world = mat2x2f(input.matrix.xy, input.matrix.zw) * local + input.placement.xy;
  var output: Fragment;
  output.position = vec4f(world / view.size * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
  output.uv = mix(input.uv.xy, input.uv.zw, corner);
  output.color = input.color;
  output.intrinsicColor = input.placement.z;
  return output;
}
@fragment fn fs(input: Fragment) -> @location(0) vec4f {
  var sampled = textureSample(atlas, atlasSampler, input.uv);
  if (input.intrinsicColor > 0.5) {
    if (view.padding.x > 0.5) { sampled = decodePremultiplied(sampled); }
    return sampled * input.color.a;
  }
  let alpha = sampled.a * input.color.a;
  let tint = select(input.color.rgb, decodeSrgb(input.color.rgb), view.padding.x > 0.5);
  return vec4f(tint * alpha, alpha);
}
`;

export const glyphInstanceFloats = 20;
export const glyphInstanceLayout = Object.freeze({arrayStride: glyphInstanceFloats * 4, stepMode: 'instance',
  attributes: Array.from({length: 5}, (_, shaderLocation) => ({shaderLocation, offset: shaderLocation * 16, format: 'float32x4'}))});
