import {fail, string} from '../host.js';
import {createEnvironmentDictionary} from './environment-dictionary.js';

const owner = 'System.Environment';
const maximumVariables = 4096;
const maximumText = 1_048_576;

function contracts(registry) {
  const {define, member} = registry;
  define(owner, {kind: 'bcl14', family: 'environment'});
  member(owner, 'GetEnvironmentVariable', ['string'], 'string', {isStatic: true});
}

function snapshot(platform) {
  if (platform.environmentSnapshot) return platform.environmentSnapshot;
  const options = platform.options ?? {};
  const environment = options.environment === undefined ? options.environmentVariables : options.environment;
  const source = environment === undefined ? {} : environment;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail(platform, 'ArgumentException', 'Session environment must be a dictionary of strings');
  }
  const entries = Object.entries(source);
  if (entries.length > maximumVariables) fail(platform, 'ArgumentException', 'Session environment variable limit exceeded');
  let textLength = 0;
  for (const [name, value] of entries) {
    if (!name || name.includes('=') || name.includes('\0') || typeof value !== 'string' || value.includes('\0')) {
      fail(platform, 'ArgumentException', 'Session environment names and values must be valid strings');
    }
    textLength += name.length + value.length;
    if (textLength > maximumText) fail(platform, 'ArgumentException', 'Session environment text limit exceeded');
  }
  const directory = options.workingDirectory ?? options.currentDirectory ?? '/';
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || directory.length > 32768) {
    fail(platform, 'ArgumentException', 'Session working directory must be a bounded nonempty path');
  }
  const variables = Object.freeze(Object.fromEntries(entries));
  platform.environmentSnapshot = Object.freeze({variables, directory});
  return platform.environmentSnapshot;
}

function invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl14' || type.family !== 'environment') return {handled: false};
  const environment = snapshot(platform);
  let value;
  switch (descriptor.name) {
    case 'GetEnvironmentVariable': {
      const name = string(platform, args[0]);
      value = platform.managed(Object.hasOwn(environment.variables, name) ? environment.variables[name] : null, 'string');
      break;
    }
    case 'GetEnvironmentVariables':
      value = createEnvironmentDictionary(platform, environment.variables);
      break;
    case 'get_CurrentDirectory':
      value = platform.managed(environment.directory, 'string');
      break;
    default:
      fail(platform, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
  }
  return {handled: true, value};
}

/** Explicit session environment only; lookup is ordinal and missing variables return null, with no operating-system access. */
export const environmentModule = Object.freeze({
  name: 'environment', families: ['environment'],
  contracts, invoke
});
