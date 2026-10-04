import {createBclRegistry} from '@sharpforge/bcl-core';
import {stringReaderModule} from './text-reader-writer.js';

export {stringReaderModule};

/** Immutable IO contributions for composition by a framework or managed runtime host. */
export const ioModules = Object.freeze([stringReaderModule]);
const registry = createBclRegistry(ioModules);

/** Register IO contracts in the caller's reserved block, after existing A09 entries. */
export function registerIoModules(target) {
  registry.register(target);
}
