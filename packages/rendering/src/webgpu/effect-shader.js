/** Fullscreen premultiplied effect stages; Gaussian passes use bounded separable kernels. */
export const effectShader = `
struct Parameters { view: vec4f, color: vec4f, coefficients: vec4f };
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var first: texture_2d<f32>;
@group(0) @binding(2) var second: texture_2d<f32>;
@group(0) @binding(3) var imageSampler: sampler;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
fn luminance(color: vec3f) -> f32 { return dot(color, vec3f(0.3, 0.59, 0.11)); }
fn setLuminance(color: vec3f, value: f32) -> vec3f {
  var result = color + vec3f(value - luminance(color));
  let low = min(result.r, min(result.g, result.b));
  let high = max(result.r, max(result.g, result.b));
  if (low < 0.0) { result = vec3f(value) + (result - vec3f(value)) * value / max(0.000001, value - low); }
  if (high > 1.0) { result = vec3f(value) + (result - vec3f(value)) * (1.0 - value) / max(0.000001, high - value); }
  return result;
}
@vertex fn vs(@builtin(vertex_index) index: u32) -> Vertex {
  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var result: Vertex;
  result.position = vec4f(points[index], 0.0, 1.0);
  result.uv = points[index] * vec2f(0.5, -0.5) + vec2f(0.5);
  return result;
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
  let mode = u32(parameters.view.z);
  let amount = parameters.view.w;
  let source = textureSample(first, imageSampler, input.uv);
  let destination = textureSample(second, imageSampler, input.uv);
  var result = source;
  if (mode <= 1u) {
    let spacing = max(1.0, amount / 64.0);
    let sigma = max(amount / spacing, 0.0001);
    let radius = i32(min(192.0, ceil(sigma * 3.0)));
    let step = select(vec2f(0.0, 1.0 / parameters.view.y), vec2f(1.0 / parameters.view.x, 0.0), mode == 0u) * spacing;
    var total = 0.0;
    result = vec4f(0.0);
    for (var offset = -192; offset <= 192; offset++) {
      if (abs(offset) <= radius) {
        let weight = exp(-f32(offset * offset) / (2.0 * sigma * sigma));
        result += textureSampleLevel(first, imageSampler, input.uv + step * f32(offset), 0.0) * weight;
        total += weight;
      }
    }
    result /= total;
  } else if (mode == 2u) {
    let gray = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722));
    result = vec4f(clamp(vec3f(gray) + (source.rgb - vec3f(gray)) * amount, vec3f(0.0), vec3f(source.a)), source.a);
  } else if (mode == 3u) {
    result = source * amount;
  } else if (mode == 4u) {
    result = source * vec4f(parameters.color.rgb * parameters.color.a, parameters.color.a);
  } else if (mode == 5u) {
    result = vec4f(parameters.color.rgb * parameters.color.a, parameters.color.a);
  } else if (mode == 6u) {
    let blend = u32(amount);
    let alpha = source.a + destination.a * (1.0 - source.a);
    if (blend == 0u) { result = source + destination * (1.0 - source.a); }
    else if (blend == 1u) {
      result = vec4f(source.rgb * destination.rgb + source.rgb * (1.0 - destination.a) + destination.rgb * (1.0 - source.a), alpha);
    } else if (blend == 2u) { result = vec4f(source.rgb + destination.rgb - source.rgb * destination.rgb, alpha); }
    else { result = clamp(source + destination, vec4f(0.0), vec4f(1.0)); }
  } else if (mode == 7u) {
    let factors = parameters.coefficients;
    result = clamp(factors.x * source * destination + factors.y * source + factors.z * destination + vec4f(factors.w), vec4f(0.0), vec4f(1.0));
  } else if (mode == 8u) { result = source * destination.a; }
  else if (mode == 9u) {
    let opacity = parameters.coefficients.x * parameters.color.a;
    let straight = source.rgb / max(0.000001, source.a);
    let luminosity = setLuminance(straight, luminance(parameters.color.rgb));
    let alpha = opacity + source.a * (1.0 - opacity);
    let rgb = parameters.color.rgb * opacity * (1.0 - source.a) + source.rgb * (1.0 - opacity) + luminosity * opacity * source.a;
    let index = u32(input.position.y) * u32(parameters.view.x) + u32(input.position.x);
    let noise = (f32(((index + 1u) * 1664525u + 1013904223u) & 255u) - 127.5) / 255.0;
    result = vec4f(clamp(rgb + vec3f(noise * amount * alpha), vec3f(0.0), vec3f(alpha)), alpha);
  } else if (mode == 10u) {
    let uv = input.uv - parameters.coefficients.xy / parameters.view.xy;
    let alpha = textureSampleLevel(first, imageSampler, uv, 0.0).a;
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let opacity = select(0.0, alpha * parameters.color.a, inside);
    result = vec4f(parameters.color.rgb * opacity, opacity);
  }
  result = vec4f(min(result.rgb, vec3f(result.a)), result.a);
  return result;
}
`;
