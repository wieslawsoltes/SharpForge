export const compositionLightingPolicy = Object.freeze({
  AmbientLight: 'unsupported', PointLight: 'unsupported', SpotLight: 'unsupported',
  DistantLight: 'unsupported', SceneLightingEffect: 'unsupported',
  reason: 'The 2D browser renderer does not expose WinUI normal-map/material lighting semantics.'
});

/** Reject lighting at creation instead of rendering a visually plausible but incorrect approximation. */
export function createCompositionLight(kind) {
  if (!Object.hasOwn(compositionLightingPolicy, kind) || kind === 'reason') throw new TypeError('Unknown composition light');
  throw new TypeError(`SF_RENDER_LIGHT_UNSUPPORTED: ${kind}. ${compositionLightingPolicy.reason}`);
}
