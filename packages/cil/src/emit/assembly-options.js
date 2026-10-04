import { CilError } from '../binary.js';

/** Validate the supported reference profile and preserve the emitted assembly name convention. */
export function emittedAssemblyName(name, framework) {
  if (!['net8', 'net9', 'net10', 'mscorlib4'].includes(framework)) throw new CilError('Supported reference profiles: net8, net9, net10, mscorlib4');
  if (typeof name !== 'string' || !name || name.length > 512 || /[\0/\\]/.test(name)) throw new CilError('Invalid assembly name');
  return name.replace(/\.dll$/i, '');
}
