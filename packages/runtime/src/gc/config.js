import {ManagedFault} from './fault.js';

const definitions = Object.freeze([
  ['Concurrent', 'concurrent', 'gcConcurrent', 'boolean'],
  ['Server', 'serverRequested', 'gcServer', 'boolean'],
  ['RetainVM', 'retainVMRequested', 'GCRetainVM', 'boolean'],
  ['ConserveMemory', 'conserveMemory', 'GCConserveMemory', 'integer', 0, 9],
  ['HeapHardLimit', 'heapHardLimitBytes', 'GCHeapHardLimit', 'integer', 1, Number.MAX_SAFE_INTEGER],
  ['HeapHardLimitPercent', 'heapHardLimitPercent', 'GCHeapHardLimitPercent', 'integer', 1, 100],
  ['Gen0Size', 'gen0Size', 'GCGen0Size', 'integer', 1, Number.MAX_SAFE_INTEGER]
]);

function configFault(name, message) {
  const fault = new ManagedFault('ArgumentException', `${name}: ${message}`);
  fault.diagnostic = Object.freeze({id: 'SF-GC-CONFIG-001', severity: 'error', setting: name, message});
  throw fault;
}

function readValue(name, value, definition, environment) {
  if (definition[3] === 'boolean') {
    if (value === true || value === 1 || environment && value === '1') return true;
    if (value === false || value === 0 || environment && value === '0') return false;
    return configFault(name, 'Expected a Boolean or an environment value of 0 or 1');
  }
  if (environment) {
    if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]+$/i.test(value)) {
      return configFault(name, 'Expected a hexadecimal integer');
    }
    value = Number(BigInt(value.startsWith('0x') || value.startsWith('0X') ? value : '0x' + value));
  }
  if (!Number.isSafeInteger(value) || value < definition[4] || value > definition[5]) {
    return configFault(name, `Expected an integer between ${definition[4]} and ${definition[5]}`);
  }
  return value;
}

function propertiesOf(runtimeConfig) {
  if (typeof runtimeConfig === 'string') {
    if (runtimeConfig.length > 1048576) configFault('runtimeconfig.json', 'Configuration exceeds one MiB');
    try {
      runtimeConfig = JSON.parse(runtimeConfig);
    } catch (error) {
      configFault('runtimeconfig.json', `Invalid JSON: ${error.message}`);
    }
  }
  const properties = runtimeConfig?.runtimeOptions?.configProperties ?? runtimeConfig?.configProperties ?? runtimeConfig ?? {};
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    configFault('runtimeconfig.json', 'Configuration properties must be an object');
  }
  return properties;
}

/**
 * Parse initialization-time System.GC.* properties and DOTNET_/COMPlus_ equivalents.
 * Environment integers are hexadecimal. Explicit options override configuration.
 * Server GC and virtual-memory retention emit bounded, stable no-op diagnostics.
 */
export function parseGCConfiguration(options = {}) {
  const properties = propertiesOf(options.runtimeConfig ?? options.runtimeconfig);
  const environment = options.environment ?? options.env ?? {};
  const result = {concurrent: true, serverGC: false, conserveMemory: 0, diagnostics: []};
  const known = new Set(definitions.map(row => 'System.GC.' + row[0]));
  for (const definition of definitions) {
    const [suffix, key, variable] = definition;
    const name = 'System.GC.' + suffix;
    if (Object.hasOwn(properties, name)) result[key] = readValue(name, properties[name], definition, false);
    for (const prefix of ['COMPlus_', 'DOTNET_']) {
      const envName = prefix + variable;
      if (Object.hasOwn(environment, envName)) result[key] = readValue(envName, environment[envName], definition, true);
    }
    if (Object.hasOwn(options, key)) result[key] = readValue(key, options[key], definition, false);
  }
  for (const name of Object.keys(properties)) {
    if (name.startsWith('System.GC.') && !known.has(name)) {
      result.diagnostics.push({id: 'SF-GC-CONFIG-002', severity: 'warning', setting: name, message: 'Unsupported GC setting; ignored'});
    }
  }
  for (const [key, setting, message] of [
    ['serverRequested', 'System.GC.Server', 'A single cooperative managed heap is used; OS-thread server GC is unavailable'],
    ['retainVMRequested', 'System.GC.RetainVM', 'JavaScript does not expose virtual-memory reservation or decommit control']
  ]) {
    if (result[key]) result.diagnostics.push({id: 'SF-GC-CONFIG-003', severity: 'warning', setting, message});
  }
  if (result.heapHardLimitPercent !== undefined && result.heapHardLimitBytes === undefined) {
    const limit = options.memoryLimitBytes;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      configFault('System.GC.HeapHardLimitPercent', 'An explicit positive memoryLimitBytes host budget is required');
    }
    result.heapHardLimitBytes = Number(BigInt(limit) * BigInt(result.heapHardLimitPercent) / 100n);
    if (result.heapHardLimitBytes < 1) configFault('System.GC.HeapHardLimitPercent', 'The resulting byte budget is zero');
  }
  if (result.heapHardLimitBytes !== undefined) result.maxBytes = result.heapHardLimitBytes;
  if (result.gen0Size !== undefined) result.initialThreshold = result.gen0Size;
  result.diagnostics = Object.freeze(result.diagnostics.slice(0, 256).map(Object.freeze));
  return Object.freeze(result);
}
