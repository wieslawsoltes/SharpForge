import {registerIoModules} from '@sharpforge/bcl-io';
import {registerJsonExtensions} from './json.js';

/** A09 additions append after the released JSON accessor without shifting its ID. */
export const ioSerializationContribution = Object.freeze({name: 'A09', register(registry) {
  registerJsonExtensions(registry);
  registerIoModules(registry);
}});
