import {getHeapStatistics} from 'node:v8';

export const resourceControlNames = Object.freeze([
  'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_MAX_OLD_SPACE_MB'
]);

/** NODE_OPTIONS is inherited by cold workers but absent from process.execArgv. */
export function resourceEnvironment() {
  return {
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    heapSizeLimit: getHeapStatistics().heap_size_limit,
    resourceControls: Object.fromEntries(resourceControlNames.map(name => [name, process.env[name] ?? null]))
  };
}

export function validateResourceEnvironment(environment) {
  const {nodeOptions, heapSizeLimit, resourceControls} = environment;
  if (nodeOptions !== null && typeof nodeOptions !== 'string' ||
      !Number.isSafeInteger(heapSizeLimit) || heapSizeLimit <= 0 ||
      !resourceControls || Object.keys(resourceControls).length !== resourceControlNames.length ||
      resourceControlNames.some(name => !Object.hasOwn(resourceControls, name) ||
        resourceControls[name] !== null && typeof resourceControls[name] !== 'string')) {
    throw new TypeError('Incomplete inherited Node options or resource limits');
  }
}
