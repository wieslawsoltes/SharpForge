import {equalBytes, sha256} from '@sharpforge/cil';
import {projectReferenceLimits} from '@sharpforge/bytecode';

const inputError = (message, code = 'PRJ0001') => Object.assign(new Error(message), {code});

function bytes(value) {
  const view = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (!(view instanceof Uint8Array) || !view.length) throw inputError('Managed launch requires PE assembly bytes');
  if (view.length > projectReferenceLimits.assemblyBytes) throw inputError('Project assembly exceeds the byte limit', 'PRJ0006');
  return view;
}

/** Validate the bounded, explicit worker request without probing paths or resolving absent artifacts. */
export function runtimeAssemblyInput(params) {
  const assembly = bytes(params.assembly);
  if (!Array.isArray(params.dependencies ?? [])) throw inputError('Project dependencies must be assembly records');
  if ((params.dependencies?.length ?? 0) > projectReferenceLimits.assemblies) {
    throw inputError('Too many supplied project assemblies', 'PRJ0006');
  }
  let totalBytes = assembly.length;
  const dependencies = (params.dependencies ?? []).map(record => {
    if (!record || typeof record !== 'object') throw inputError('Invalid project assembly record');
    const dependency = {assembly: bytes(record.assembly)};
    if (!equalBytes(dependency.assembly, assembly)) totalBytes += dependency.assembly.length;
    for (const name of ['project', 'contextId']) {
      const value = record[name];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) {
        throw inputError('Invalid project assembly provenance');
      }
      dependency[name] = value;
    }
    return dependency;
  }).filter(record => !equalBytes(record.assembly, assembly));
  if (totalBytes > projectReferenceLimits.totalBytes) throw inputError('Project assemblies exceed the total byte limit', 'PRJ0006');
  return {assembly, dependencies, totalBytes};
}

const digest = bytes => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

/** The key covers every supplied artifact and provenance record, including unused dependencies. */
export function runtimeInputKey(input, managedIL) {
  return JSON.stringify([managedIL, digest(input.assembly), input.dependencies.map(record =>
    [digest(record.assembly), record.project ?? null, record.contextId ?? null])]);
}

export function sameSingleAssembly(cached, input, managedIL) {
  return !!cached && !cached.key && cached.managedIL === managedIL && equalBytes(cached.bytes, input.assembly);
}

/** A graph update must carry the complete dependency set so references and symbols cannot become stale. */
export function requireSingleAssemblyUpdate(session, operation) {
  if ((session?.vm?.inspector?.projectAssemblies?.length ?? session?.vm?.image?.il?.modules?.length ?? 0) > 1) {
    throw inputError(operation + ' requires relaunching the complete project assembly graph', 'SF_RUNTIME_GRAPH_UPDATE');
  }
}
