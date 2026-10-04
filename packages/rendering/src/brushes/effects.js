import {DrawingError, finite} from '../drawing/commands.js';

export {validateEffectGraph} from '../composition/effects.js';

export function gaussianWeights(sigma, maxRadius = 256) {
  finite(sigma, 'Gaussian sigma', 0, maxRadius / 3);
  if (!sigma) return new Float32Array([1]);
  const radius = Math.min(maxRadius, Math.ceil(sigma * 3)), weights = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) { const weight = Math.exp(-offset * offset / (2 * sigma * sigma));
    weights[offset + radius] = weight; sum += weight; }
  for (let index = 0; index < weights.length; index++) weights[index] /= sum;
  return weights;
}

/** Browser backdrop policy explicitly distinguishes an approximation from native desktop materials. */
export function systemBackdropPolicy(type, {theme = 'light', highContrast = false, reducedTransparency = false} = {}) {
  if (!['MicaBackdrop', 'DesktopAcrylicBackdrop', 'SystemBackdrop'].includes(type)) {
    throw new DrawingError('SFRENDER072', `Unknown system backdrop ${type}`);
  }
  return {type, support: 'approximated', reason: 'Browser has no desktop compositor or wallpaper access',
    color: highContrast ? (theme === 'dark' ? '#000000' : '#ffffff') : theme === 'dark' ? '#202020' : '#f3f3f3',
    blur: type === 'DesktopAcrylicBackdrop' && !reducedTransparency && !highContrast ? 30 : 0};
}

export class XamlCompositionBrushBase {
  constructor() { this.CompositionBrush = null; this.connections = 0; }
  connect() {
    if (this.connections++ === 0) this.OnConnected();
    let released = false;
    return () => { if (!released) { released = true; this.disconnect(); } };
  }
  disconnect() { if (this.connections && --this.connections === 0) this.OnDisconnected(); }
  OnConnected() {}
  OnDisconnected() { this.CompositionBrush = null; }
  dispose() { if (this.connections) { this.connections = 0; this.OnDisconnected(); } }
}
