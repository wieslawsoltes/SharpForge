import {projectReferenceLimits} from '@sharpforge/bytecode';

function emittedAssembly(artifact) {
  if (artifact?.success !== true || !(artifact.assembly instanceof Uint8Array) || !artifact.assembly.length) {
    throw new Error('Every project runtime artifact must contain successfully emitted PE bytes');
  }
  if (artifact.assembly.length > projectReferenceLimits.assemblyBytes) {
    throw new RangeError('Project runtime assembly byte limit exceeded');
  }
  return artifact.assembly;
}

/** Select only successful PE artifact bytes for a worker launch, without cloning analysis graphs on the UI thread. */
export function projectRuntimeDependencies(result) {
  if (result?.success !== true) throw new Error('A successful build is required before launching project artifacts');
  const artifacts = result.projectArtifacts ?? [];
  if (!Array.isArray(artifacts) || artifacts.length > projectReferenceLimits.assemblies) {
    throw new RangeError('Project runtime artifact-count limit exceeded');
  }
  const dependencies = [];
  let totalBytes = result.assembly?.byteLength ?? 0;
  for (const artifact of artifacts) {
    const assembly = emittedAssembly(artifact);
    if (assembly === result.assembly) continue;
    totalBytes += assembly.length;
    if (totalBytes > projectReferenceLimits.totalBytes) throw new RangeError('Project runtime aggregate byte limit exceeded');
    dependencies.push({assembly, project: artifact.project, contextId: artifact.contextId});
  }
  emittedAssembly(result);
  return dependencies;
}
