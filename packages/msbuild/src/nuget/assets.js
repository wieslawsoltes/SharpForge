/** Read NuGet restore's authoritative per-TFM/RID graph rather than re-solving its dependency decisions. */
export function readProjectAssets(input, { maxLibraries = 50000 } = {}) {
  if (typeof input === 'string' && input.length > 134217728) throw new Error('Assets file size limit exceeded');
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  if (document?.version !== 3 || !document.targets || !document.libraries) throw new Error('Expected project.assets.json version 3');
  if (Object.keys(document.libraries).length > maxLibraries) throw new Error('Assets library limit exceeded');
  const frameworks = [];
  for (const [name, libraries] of Object.entries(document.targets)) {
    const [tfm, runtimeIdentifier = ''] = name.split('/');
    const projectFramework = document.project?.frameworks?.[tfm] ?? Object.values(document.project?.frameworks ?? {})
      .find(value => value.targetAlias === tfm) ?? {};
    const direct = new Set(Object.keys(projectFramework.dependencies ?? {}).map(value => value.toLowerCase()));
    for (const group of document.projectFileDependencyGroups?.[tfm] ?? []) direct.add(group.split(' ')[0].toLowerCase());
    const nodes = Object.entries(libraries).map(([identity, library]) => {
      const separator = identity.lastIndexOf('/'), id = identity.slice(0, separator), version = identity.slice(separator + 1);
      return { identity, id, version, direct: direct.has(id.toLowerCase()), transitive: !direct.has(id.toLowerCase()),
        type: library.type, dependencies: Object.entries(library.dependencies ?? {}).map(([packageId, range]) => ({ id: packageId, range })),
        compile: Object.keys(library.compile ?? {}), runtime: Object.keys(library.runtime ?? {}),
        runtimeTargets: library.runtimeTargets ?? {}, build: Object.keys(library.build ?? {}),
        contentFiles: library.contentFiles ?? {}, metadata: document.libraries[identity] ?? {} };
    });
    frameworks.push({ name, targetFramework: tfm, runtimeIdentifier, nodes });
  }
  return { version: 1, frameworks, packageFolders: Object.keys(document.packageFolders ?? {}),
    diagnostics: (document.logs ?? []).map(log => ({ code: log.code, severity: log.level === 'Error' ? 'error' : 'warning',
      message: log.message, libraryId: log.libraryId ?? null, targetGraphs: log.targetGraphs ?? [] })) };
}
