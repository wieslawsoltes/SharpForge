import { MetadataBuilder } from '../metadata.js';
import { validateInput } from '../analysis.js';
import { emissionPEOptions } from './pe-options.js';
import { emittedAssemblyName } from './assembly-options.js';
import { emissionMetadataOptions } from './reference-options.js';
import {CilError} from '../binary.js';

/** Prepare bounded metadata/target inputs before assigning any definition or method tokens. */
export function prepareEmission(image, options) {
  const { framework = 'net8', embedSources = true, includeDebug = true } = options;
  const peOptions = emissionPEOptions(image, options, framework);
  validateInput(image);
  if (image.statics.some(slot => slot.value !== null && typeof slot.value === 'object' && Object.hasOwn(slot.value, 'readonlyField'))) {
    throw new CilError('Readonly field loads cannot be static default values');
  }
  if (framework === 'mscorlib4' && image.constants.some(value => value !== null &&
      typeof value === 'object' && Object.hasOwn(value, 'readonlyField'))) {
    throw new CilError('Readonly string field loads require the System.Runtime source emission profile');
  }
  const name = emittedAssemblyName(options.name ?? image.name ?? 'Application', framework);
  const started = performance.now();
  const metadata = new MetadataBuilder(name, emissionMetadataOptions(options, framework));
  return { name, framework, embedSources, includeDebug, peOptions, metadata, started };
}
