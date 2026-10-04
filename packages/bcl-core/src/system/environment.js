import { string } from '../host.js';

const owner = 'System.Environment';

function contracts({ define, member }) {
  define(owner, { kind: 'bcl14', family: 'environment' });
  member(owner, 'GetEnvironmentVariable', ['string'], 'string', { isStatic: true });
}

function invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl14' || type.family !== 'environment') return { handled: false };
  const name = string(platform, args[0]);
  const environment = platform.options.environment ?? {};
  const value = Object.hasOwn(environment, name) ? environment[name] : null;
  return { handled: true, value: platform.managed(value, 'string') };
}

/** Browser process variables are case-sensitive, read-only and isolated in each platform's launch options. */
export const environmentModule = Object.freeze({ name: 'environment', families: ['environment'], contracts, invoke });
