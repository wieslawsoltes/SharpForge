import {CompositionTarget} from './composition-target.js';
import {CompositionPropertySet} from './property-set.js';

/** Standard composition objects own one typed auxiliary property set. */
export class CompositionObject extends CompositionTarget {
  constructor(compositor, kind, schema = {}) {
    super(compositor, kind, schema);
    this.Properties = new CompositionPropertySet(compositor);
  }
}

export {owned} from './composition-target.js';
