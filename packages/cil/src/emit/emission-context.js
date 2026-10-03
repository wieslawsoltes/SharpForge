import { MetadataBuilder } from '../metadata.js';
import { validateInput } from '../analysis.js';
import { emissionPEOptions } from './pe-options.js';
import { emittedAssemblyName } from './assembly-options.js';
import { emissionMetadataOptions } from './reference-options.js';

/** Prepare bounded metadata/target inputs before assigning any definition or method tokens. */
export function prepareEmission(image, options) {
  const { framework = 'net8', embedSources = true, includeDebug = true } = options;
  const peOptions = emissionPEOptions(image, options, framework);
  validateInput(image);
  const name = emittedAssemblyName(options.name ?? image.name ?? 'Application', framework);
  const started = performance.now();
  const metadata = new MetadataBuilder(name, emissionMetadataOptions(options, framework));
  return { name, framework, embedSources, includeDebug, peOptions, metadata, started };
}
