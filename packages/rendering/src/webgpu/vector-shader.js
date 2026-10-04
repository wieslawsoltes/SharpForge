import {colorShader} from './color-shader.js';

/** Premultiplied color and image shader; radial ramps are sampled in transformed brush coordinates. */
export const vectorShader = `
${colorShader}
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
struct Vertex {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) paint: vec4f,
};
struct Fragment {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) paint: vec4f,
};
@vertex fn vs(vertex: Vertex) -> Fragment {
  var output: Fragment;
  output.position = vec4f(vertex.position / view.size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.uv = vertex.uv;
  output.color = vertex.color;
  output.paint = vertex.paint;
  return output;
}
fn shade(fragment: Fragment) -> vec4f {
  var uv = fragment.uv;
  let clipped = fragment.paint.x > 1.5 && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)));
  if (fragment.paint.x > 0.5 && fragment.paint.x <= 1.5) {
    let origin = fragment.paint.yz;
    let direction = uv - origin;
    let a = dot(direction, direction);
    let b = 2.0 * dot(origin, direction);
    let c = dot(origin, origin) - 1.0;
    let discriminant = max(0.0, b * b - 4.0 * a * c);
    let extent = select(1e20, (-b + sqrt(discriminant)) / max(2.0 * a, 1e-20), a > 1e-20);
    uv = vec2f(select(1.0, 1.0 / extent, extent > 0.0), 0.5);
  }
  var sampled = textureSample(image, imageSampler, uv);
  if (clipped) { discard; }
  var tint = fragment.color.rgb;
  if (view.padding.x > 0.5) {
    if (fragment.paint.w < 0.5) { sampled = decodePremultiplied(sampled); }
    tint = decodeSrgb(tint);
  }
  return vec4f(sampled.rgb * tint * fragment.color.a, sampled.a * fragment.color.a);
}
@fragment fn fs(fragment: Fragment) -> @location(0) vec4f { return shade(fragment); }
@fragment fn fsPresent(fragment: Fragment) -> @location(0) vec4f {
  let color = shade(fragment);
  return select(color, encodePremultiplied(color), view.padding.x > 0.5);
}
`;

export const vertexLayout = Object.freeze({arrayStride: 48, attributes: [
  {shaderLocation: 0, offset: 0, format: 'float32x2'}, {shaderLocation: 1, offset: 8, format: 'float32x2'},
  {shaderLocation: 2, offset: 16, format: 'float32x4'}, {shaderLocation: 3, offset: 32, format: 'float32x4'}
]});

export const premultipliedBlend = Object.freeze({
  color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}
});
