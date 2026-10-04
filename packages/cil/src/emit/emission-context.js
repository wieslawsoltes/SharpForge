import { MetadataBuilder } from '../metadata.js';
import { validateInput } from '../analysis.js';
import { emissionPEOptions } from './pe-options.js';
import { emittedAssemblyName } from './assembly-options.js';
import { emissionMetadataOptions } from './reference-options.js';
import { emitProjectAttributes, projectTypeDescriptors } from './project-metadata.js';
import { memberDefinitionProfile } from '../metadata/member-definitions.js';

/** Prepare bounded metadata/target inputs before assigning any definition or method tokens. */
export function prepareEmission(image, options) {
  const { framework = 'net8', embedSources = true, includeDebug = true } = options;
  const peOptions = emissionPEOptions(image, options, framework);
  validateInput(image);
  const name = emittedAssemblyName(options.name ?? image.name ?? 'Application', framework);
  const started = performance.now();
  const metadata = new MetadataBuilder(name, emissionMetadataOptions(options, framework));
  emitProjectAttributes(metadata, options);
  const typeDescriptors = projectTypeDescriptors(image, options.typeDefinitions, peOptions);
  const memberDefinitions = memberDefinitionProfile(image, options.memberDefinitions);
  return { name, framework, embedSources, includeDebug, peOptions, metadata, typeDescriptors, memberDefinitions, started };
}
