import {stringModule} from './system/string.js';
import {stringBuilderModule} from './text/string-builder.js';
import {formattingModule} from './formatting/index.js';
import {arrayModule} from './system/array.js';
import {randomModule} from './system/random.js';

/** Released registration groups are ordered ABI slots, not discovery order. */
export const bclModules = Object.freeze([
  {...stringBuilderModule, group: 'bcl-prefix'},
  {...stringModule, group: 'bcl-suffix'},
  {...formattingModule, group: 'bcl-suffix'},
  {...arrayModule, group: 'runtime14'},
  {...randomModule, group: 'runtime14'}
].map(module => Object.freeze(module)));
