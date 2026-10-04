import {CilError} from '../binary.js';
import {emitAssembly} from '../emitter.js';
import {canonicalWithSymbols} from '../pe/canonical-symbols.js';
import {projectEmissionOptions} from './project-profile.js';
import {canonicalEmissionOptions} from '../pe/canonical-options.js';

/** Reject altered instructions, metadata, resources or scaffolding before exposing an executable image. */
export function verifyCanonicalProfile(image, pe, debug) {
  const options = canonicalEmissionOptions(pe, debug);
  const project = projectEmissionOptions(pe, debug, image);
  if (project.resources) delete options.managedResources;
  const canonical = emitAssembly(image, {...options, ...project});
  if (!canonicalWithSymbols(canonical, pe)) {
    throw new CilError('Assembly is not canonical for the supported CIL profile; '
      + 'modified scaffolding, signatures, references, resources or instructions are rejected');
  }
}
