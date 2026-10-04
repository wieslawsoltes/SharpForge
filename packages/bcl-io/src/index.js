import {createBclRegistry} from '@sharpforge/bcl-core';
import {stringReaderModule} from './text-reader-writer.js';
import {stringWriterModule} from './text-writer.js';

export {stringReaderModule, stringWriterModule};

/** Immutable IO contributions for composition by a framework or managed runtime host. */
export const ioModules = Object.freeze([stringReaderModule, stringWriterModule]);
const registry = createBclRegistry(ioModules);

/** Register IO contracts in the caller's reserved block, after existing A09 entries. */
export function registerIoModules(target) {
  // Base reader/writer contracts precede every extension: their order is part of the A09 ABI.
  registry.register(target, {group: 'bcl-io'});
  registry.register(target, {group: 'extensions'});
}
