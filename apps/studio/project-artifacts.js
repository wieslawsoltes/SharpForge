const caches = new WeakMap();
const keyOf = value => value.contextId ?? value.project;
const sameBytes = (left, right) => left === right || left?.length === right?.length && left?.every((byte, index) => byte === right[index]);

function sameInputs(previous, current) {
  if (previous.assemblyName !== current.assemblyName || JSON.stringify(previous.options) !== JSON.stringify(current.options)) return false;
  if (previous.sources.length !== current.sources.length) return false;
  if (!previous.sources.every((source, index) => {
    const other = current.sources[index];
    return (source.uri ?? source.path) === (other.uri ?? other.path) && source.text === other.text && source.version === other.version;
  })) return false;
  const refs = current.metadataReferences ?? [];
  if ((previous.metadataReferences?.length ?? 0) !== refs.length) return false;
  if (!(previous.metadataReferences ?? []).every((reference, index) => reference.hintPath === refs[index].hintPath
    && reference.name === refs[index].name && JSON.stringify(reference.metadata) === JSON.stringify(refs[index].metadata)
    && sameBytes(reference.bytes, refs[index].bytes))) return false;
  const resources = current.resources ?? [];
  if ((previous.resources?.length ?? 0) !== resources.length || !(previous.resources ?? []).every((resource, index) =>
    resource.manifestName === resources[index].manifestName && resource.culture === resources[index].culture
    && sameBytes(resource.bytes, resources[index].bytes))) return false;
  if (JSON.stringify(previous.assemblyAttributes ?? []) !== JSON.stringify(current.assemblyAttributes ?? [])) return false;
  return JSON.stringify(previous.references ?? []) === JSON.stringify(current.references ?? []);
}

/** Keep successful dependency metadata independently of the editor's latest analysis response. */
export function rememberProjectArtifacts(system, plan, result) {
  if (!system || !plan) return;
  const cache = caches.get(system) ?? new Map();
  caches.set(system, cache);
  const artifacts = new Map((result.projectArtifacts ?? []).map(artifact => [keyOf(artifact), artifact]));
  for (const unit of plan.units) {
    const key = keyOf(unit);
    const artifact = artifacts.get(key);
    if (!artifact?.success || !(artifact.assembly instanceof Uint8Array) || !artifact.assembly.length) { cache.delete(key); continue; }
    cache.set(key, {unit, artifact});
  }
}

/** Context/options/source changes invalidate their own metadata and every dependent cache entry. */
export function cachedProjectArtifacts(state, plan) {
  const cache = caches.get(state.projectSystem);
  const valid = new Map();
  for (const unit of plan.units) {
    const key = keyOf(unit);
    const cached = cache?.get(key);
    if (!cached || !sameInputs(cached.unit, unit) || (unit.references ?? []).some(reference =>
      reference.referenceOutputAssembly !== false && !valid.has(keyOf(reference)))) {
      cache?.delete(key);
      continue;
    }
    valid.set(key, cached.artifact);
  }
  return valid;
}
