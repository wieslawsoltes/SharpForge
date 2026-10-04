/** Source execution admits only resolved images; the bytecode verifier also serves pre-link CIL emission. */
export function assertLinkedRuntimeImage(image) {
  if (image.externalReferences !== undefined) throw Object.assign(new Error(
    'Resolve the complete supplied SharpForge project assembly graph before creating a managed runtime session'
  ), {code: 'SF_RUNTIME_DEPENDENCIES'});
}
