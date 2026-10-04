import {CompositionObject, owned} from './composition-object.js';
import {finite, color, vector} from './values.js';

/** Retained shadow descriptors are consumed by the renderer's mask/blur/composite passes. */
export class DropShadow extends CompositionObject {
  constructor(compositor) {
    super(compositor, 'DropShadow', {
      BlurRadius: {default: 16, validate: value => finite(value, 'shadow blur radius', 0, 250)},
      Offset: {default: Object.freeze([0, 0, 0]), validate: value => vector(value, 3)},
      Color: {default: Object.freeze([0, 0, 0, 1]), validate: color},
      Opacity: {default: 1, validate: value => finite(value, 'shadow opacity', 0, 1)},
      Mask: {default: null, validate: (value, owner) => owned(value, owner, item => item.kind.endsWith('Brush'))}
    });
  }
  descriptor() {
    return {kind: 'drop-shadow', blurRadius: this.BlurRadius, offset: this.Offset, color: this.Color,
      opacity: this.Opacity, mask: this.Mask?.descriptor() ?? null};
  }
}
