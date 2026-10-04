/** Shared transfer functions keep presentation, atlas images and analytic primitives on the same color contract. */
export const colorShader = `
fn decodeSrgb(color: vec3f) -> vec3f {
  let value = clamp(color, vec3f(0.0), vec3f(1.0));
  return select(pow((value + vec3f(0.055)) / 1.055, vec3f(2.4)), value / 12.92, value <= vec3f(0.04045));
}
fn encodeSrgb(color: vec3f) -> vec3f {
  let value = clamp(color, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(value, vec3f(1.0 / 2.4)) - vec3f(0.055), value * 12.92, value <= vec3f(0.0031308));
}
fn decodePremultiplied(color: vec4f) -> vec4f {
  return vec4f(decodeSrgb(color.rgb / max(color.a, 0.000001)) * color.a, color.a);
}
fn encodePremultiplied(color: vec4f) -> vec4f {
  return vec4f(encodeSrgb(color.rgb / max(color.a, 0.000001)) * color.a, color.a);
}
`;
