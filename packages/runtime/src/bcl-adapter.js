import {isDecimal, decimalFormat} from './execution/decimal.js';
import {invokeObjectToString} from './execution/managed-object-string.js';
import {createBclRegistry, bclModules} from '@sharpforge/bcl-core';
import {closedCollectionsModule} from '@sharpforge/bcl-collections';
import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';
import {invokeBcl} from './bcl.js';
import {invokeJson} from './json.js';
import {invokeNetwork} from './network.js';
import {invokeNumeric} from './numeric.js';
import {invokePlatformArray} from './execution/platform-array-calls.js';

const modules = createBclRegistry([...bclModules, closedCollectionsModule]);
const runtimeFamilies = new Map([['array', invokePlatformArray]]);

const services = Object.freeze({
  frameworkType,
  invokeObjectToString,
  formatDecimal(value, format) {
    return isDecimal(value) ? decimalFormat(value, format, {fault: (name, message) => new ManagedFault(name, message)}) : null;
  },
  isReference,
  fault(type, message, reference = null) { throw new ManagedFault(type, message, reference); }
});

/** Attach immutable services; each platform retains its own managed state. */
export function initializeBclHost(platform) {
  platform.bclHost = services;
}

function invokeCore(platform, descriptor, args, type) {
  const result = modules.invoke(platform, descriptor, args, type);
  return result.handled ? result : invokeBcl(platform, descriptor, args, type);
}

function invokeRuntime14(platform, descriptor, args, type) {
  const adapted = runtimeFamilies.get(type.family)?.(platform, descriptor, args);
  if (adapted?.handled) return adapted;
  return type.family?.startsWith('json') ? invokeJson(platform, descriptor, args) :
    modules.invoke(platform, descriptor, args, type);
}

const handlers = Object.freeze({
  bcl: invokeCore,
  bcl14: invokeRuntime14,
  network: invokeNetwork,
  numeric: invokeNumeric,
  json: invokeJson
});

/** Route legacy kinds without probing networking or numeric handlers for BCL calls. */
export function invokeBclPlatform(platform, descriptor, args, type) {
  return handlers[type?.kind]?.(platform, descriptor, args, type);
}
