import {objectComparerModule} from './system/object-comparer.js';
import {stringModule} from './system/string.js';
import {stringBuilderModule} from './text/string-builder.js';
import {formattingModule} from './formatting/index.js';
import {arrayModule} from './system/array.js';
import {randomModule} from './system/random.js';
import {environmentModule} from './system/environment.js';
import {stringComparerModule} from './system/string-comparer.js';

/** Released registration groups are ordered ABI slots, not discovery order. */
export const bclModules = Object.freeze([
  {...stringBuilderModule, group: 'bcl-prefix'},
  {...stringModule, group: 'bcl-suffix'},
  {...formattingModule, group: 'bcl-suffix'},
  {...arrayModule, group: 'runtime14'},
  {...randomModule, group: 'runtime14'},
  {...environmentModule, group: 'extensions'},
  {...stringComparerModule, group: 'extensions'},
  objectComparerModule
].map(module => Object.freeze(module)));
