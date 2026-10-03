import {invokeBclModules} from '@sharpforge/bcl-core';
import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';
import {invokeBcl} from './bcl.js';
import {invokeJson} from './json.js';
import {invokeNetwork} from './network.js';
import {invokeNumeric} from './numeric.js';

const services = Object.freeze({
  frameworkType,
  isReference,
  fault(type, message) { throw new ManagedFault(type, message); }
});

/** Attach immutable services; each platform retains its own managed state. */
export function initializeBclHost(platform) {
  platform.bclHost = services;
}

function invokeCore(platform, descriptor, args, type) {
  const result = invokeBclModules(platform, descriptor, args, type);
  return result.handled ? result : invokeBcl(platform, descriptor, args, type);
}

function invokeRuntime14(platform, descriptor, args, type) {
  return type.family?.startsWith('json') ? invokeJson(platform, descriptor, args) :
    invokeBclModules(platform, descriptor, args, type);
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
