export const projectContextKey = value => value.contextId ?? value.project;

/** Seeds are prior successful compiler outputs, never an implicit external-reference runtime profile. */
export function projectDependencyArtifacts(plan) {
  const inputs = plan?.dependencyArtifacts ?? [];
  if (!Array.isArray(inputs) || inputs.length > 512) throw new RangeError('Project artifact-count limit exceeded');
  const artifacts = new Map();
  let bytes = 0;
  for (const artifact of inputs) {
    const key = projectContextKey(artifact);
    if (typeof key !== 'string' || !key || typeof artifact.project !== 'string' || artifacts.has(key)
      || artifact.success !== true || artifact.runtimeProfile !== 'sharpforge'
      || !(artifact.assembly instanceof Uint8Array) || !artifact.assembly.length) {
      throw new TypeError('Project dependency artifacts require unique context IDs and successful emitted assembly bytes');
    }
    bytes += artifact.assembly.length;
    if (bytes > 128 * 1024 * 1024) throw new RangeError('Project dependency artifact byte budget exceeded');
    artifacts.set(key, artifact);
  }
  return artifacts;
}

/** All units and prior artifacts share one bounded, dependency-ordered context namespace. */
export function validateProjectPlan(plan, artifacts) {
  if (!Array.isArray(plan?.units) || !plan.units.length || plan.units.length + artifacts.size > 512) {
    throw new RangeError('Build plan requires between one and 512 compilation contexts');
  }
  const seen = new Set(artifacts.keys());
  const units = new Set();
  for (const unit of plan.units) {
    const key = projectContextKey(unit);
    if (typeof unit.project !== 'string' || typeof key !== 'string' || !key || seen.has(key)) {
      throw new Error('Duplicate or invalid project context in build plan');
    }
    if (!Array.isArray(unit.sources) || unit.sources.length > 20000) throw new RangeError('Project source-count limit exceeded');
    for (const reference of unit.references ?? []) {
      if (!seen.has(projectContextKey(reference))) throw new Error('Build plan is not in dependency order: ' + reference.project);
    }
    seen.add(key);
    units.add(key);
  }
  if (!units.has(plan.startupContextId ?? plan.startup)) throw new Error('Startup project is absent from the build plan');
}
