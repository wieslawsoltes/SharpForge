import {colorShader} from './color-shader.js';

/** Instanced analytic shapes use derivative coverage in pixel space, alongside the path MSAA pipeline. */
export const analyticShader = `
${colorShader}
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct Instance {
  @location(0) rect: vec4f, @location(1) radiiX: vec4f, @location(2) radiiY: vec4f,
  @location(3) fill: vec4f, @location(4) stroke: vec4f,
  @location(5) matrix: vec4f, @location(6) translate: vec4f, @location(7) extra: vec4f,
};
struct Fragment {
  @builtin(position) position: vec4f, @location(0) local: vec2f,
  @location(1) @interpolate(flat) rect: vec4f,
  @location(2) @interpolate(flat) radiiX: vec4f, @location(3) @interpolate(flat) radiiY: vec4f,
  @location(4) @interpolate(flat) fill: vec4f, @location(5) @interpolate(flat) stroke: vec4f,
  @location(6) @interpolate(flat) shape: vec4f,
};
@vertex fn vs(input: Instance, @builtin(vertex_index) vertex: u32) -> Fragment {
  let corners = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let pad = input.translate.z * 0.5 + input.extra.x;
  let local = input.rect.xy - vec2f(pad) + corners[vertex] * (input.rect.zw + vec2f(pad * 2.0));
  let world = mat2x2f(input.matrix.xy, input.matrix.zw) * local + input.translate.xy;
  var output: Fragment;
  output.position = vec4f(world / view.size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.local = local; output.rect = input.rect; output.radiiX = input.radiiX; output.radiiY = input.radiiY;
  output.fill = input.fill; output.stroke = input.stroke;
  output.shape = vec4f(input.translate.zw, input.extra.yz);
  return output;
}
fn ellipseDistance(point: vec2f, radii: vec2f) -> f32 {
  let q = abs(point); let r = max(radii, vec2f(0.00001));
  var angle = atan2(q.y * r.x, q.x * r.y);
  for (var iteration = 0; iteration < 8; iteration++) {
    let cs = vec2f(cos(angle), sin(angle));
    let edge = r * cs; let tangent = r * vec2f(-cs.y, cs.x);
    let delta = edge - q;
    let first = dot(delta, tangent); let second = dot(tangent, tangent) - dot(delta, edge);
    if (abs(second) > 0.000001) { angle = clamp(angle - first / second, 0.0, 1.57079632679); }
  }
  let closest = r * vec2f(cos(angle), sin(angle));
  let magnitude = min(length(q - closest), min(length(q - vec2f(r.x, 0)), length(q - vec2f(0, r.y))));
  return select(magnitude, -magnitude, dot(q / r, q / r) < 1.0);
}
fn roundedDistance(point: vec2f, rect: vec4f, radiiX: vec4f, radiiY: vec4f, inflate: f32) -> f32 {
  let center = rect.xy + rect.zw * 0.5;
  let halfSize = max(vec2f(0.0), rect.zw * 0.5 + vec2f(inflate));
  let quadrant = select(select(0u, 1u, point.x > center.x), select(3u, 2u, point.x > center.x), point.y > center.y);
  let radius = clamp(vec2f(radiiX[quadrant], radiiY[quadrant]) + vec2f(inflate), vec2f(0), halfSize);
  let local = abs(point - center) - (halfSize - radius);
  if (all(local > vec2f(0)) && all(radius > vec2f(0))) { return ellipseDistance(local, radius); }
  let edge = abs(point - center) - halfSize;
  return length(max(edge, vec2f(0))) + min(max(edge.x, edge.y), 0.0);
}
fn coverage(distance: f32) -> f32 { return clamp(0.5 - distance / max(fwidth(distance), 0.00001), 0.0, 1.0); }
@fragment fn fs(input: Fragment) -> @location(0) vec4f {
  let halfStroke = input.shape.x * 0.5;
  var distance = roundedDistance(input.local, input.rect, input.radiiX, input.radiiY, 0.0);
  var strokeOutside = 0.0;
  var strokeInside = 1000000000.0;
  if (input.shape.y > 0.5) {
    distance = ellipseDistance(input.local - input.rect.xy - input.rect.zw * 0.5, input.rect.zw * 0.5);
    strokeOutside = abs(distance) - halfStroke;
  } else {
    strokeOutside = roundedDistance(input.local, input.rect, input.radiiX, input.radiiY, halfStroke);
    strokeInside = roundedDistance(input.local, input.rect, input.radiiX, input.radiiY, -halfStroke);
  }
  let strokeCoverage = coverage(strokeOutside) * (1.0 - coverage(strokeInside));
  let fillAlpha = input.fill.a * coverage(distance);
  let strokeAlpha = input.stroke.a * strokeCoverage;
  let alpha = strokeAlpha + fillAlpha * (1.0 - strokeAlpha);
  let strokeColor = select(input.stroke.rgb, decodeSrgb(input.stroke.rgb), view.padding.x > 0.5);
  let fillColor = select(input.fill.rgb, decodeSrgb(input.fill.rgb), view.padding.x > 0.5);
  return vec4f(strokeColor * strokeAlpha + fillColor * fillAlpha * (1.0 - strokeAlpha), alpha);
}
`;

export const analyticInstanceLayout = Object.freeze({arrayStride: 128, stepMode: 'instance',
  attributes: Array.from({length: 8}, (_, shaderLocation) => ({shaderLocation, offset: shaderLocation * 16, format: 'float32x4'}))});
