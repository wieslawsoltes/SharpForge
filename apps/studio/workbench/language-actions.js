/** Project-isolated semantic batches. This coordinator returns preview data and never commits editor or resource state. */
export function createWorkspaceLanguageActions({projects, documents, getProjectDocuments}) {
  if (typeof getProjectDocuments !== 'function') throw new TypeError('Explicit project-owned source enumeration is required');
  const builds = projects.services.builds;
  const source = uri => {
    const record = documents.get(uri);
    if (!record) throw new Error(`Language source is unavailable: ${uri}`);
    return {uri, version: record.version, model: documents.models?.get(uri), record};
  };
  const checkSource = captured => {
    const current = source(captured.uri);
    if (current.version !== captured.version || current.model !== captured.model || current.record !== captured.record) {
      throw new Error(`Source changed while preparing the workspace action: ${captured.uri}`);
    }
  };
  const capture = service => {
    const snapshot = service.snapshot();
    const owned = [...new Set(getProjectDocuments(service.id))];
    const versions = new Map(snapshot.files.map(file => [file.uri, file.version]));
    if (owned.some(uri => !versions.has(uri))) throw new Error('Project-owned source is missing from its compiler snapshot');
    return {service, revision: service.revision, snapshot, owned,
      sources: snapshot.files.map(file => {
        const value = source(file.uri);
        if (value.version !== file.version) throw new Error('Project snapshot is stale');
        return value;
      }), ownership: {projects: [{id: service.id, documents: owned.map(uri => ({uri, version: versions.get(uri)}))}]}};
  };
  const verify = captured => {
    if (builds.get(captured.service.id) !== captured.service || captured.service.revision !== captured.revision) {
      throw new Error('Project changed while preparing the workspace action');
    }
    const owned = [...new Set(getProjectDocuments(captured.service.id))];
    if (owned.length !== captured.owned.length || owned.some(uri => !captured.owned.includes(uri))) {
      throw new Error('Project ownership changed while preparing the workspace action');
    }
    captured.sources.forEach(checkSource);
  };
  const request = async (captured, method, parameters, options) => {
    options.signal?.throwIfAborted();
    verify(captured);
    const result = await captured.service.request(method, {...parameters, projectId: captured.service.id,
      files: captured.snapshot.files, compilationOptions: captured.snapshot.compilationOptions,
      extensions: captured.snapshot.extensions}, options);
    options.signal?.throwIfAborted();
    verify(captured);
    return result;
  };
  const origin = parameters => {
    projects.sync();
    const captured = source(parameters.uri);
    if (parameters.version !== undefined && captured.version !== parameters.version) throw new Error('Language action origin is stale');
    return captured;
  };
  const validateMerged = async (batches, merged, options, rename) => {
    await Promise.all(batches.map(batch => {
      const available = new Set(batch.sources.map(item => item.uri));
      const edits = merged.edits.filter(edit => available.has(edit.uri));
      const anchor = rename ? batch.sources.find(item => item.uri === rename.uri) : batch.sources[0];
      return request(batch, 'validateWorkspaceEdit', {uri: anchor.uri, version: anchor.version, edits, rename}, options);
    }));
    batches.forEach(verify);
  };

  return {
    async codeActions(parameters, options = {}) {
      const start = origin(parameters);
      const service = projects.serviceFor(parameters.uri, parameters.projectId);
      if (!parameters.scope || parameters.scope === 'document') {
        return request(capture(service), 'codeActions', {...parameters, version: start.version}, options);
      }
      if (!['project', 'solution'].includes(parameters.scope)) throw new Error('Unknown Fix All scope');
      const services = parameters.scope === 'solution' ? builds.list() : [service];
      const batches = services.map(capture).filter(batch => batch.owned.length);
      if (!batches.some(batch => batch.owned.includes(start.uri))) throw new Error('Fix All origin is outside the requested scope');
      const ids = builds.list().map(item => item.id).sort().join('\n');
      const results = await Promise.all(batches.map(async batch => {
        const uri = batch.owned.includes(start.uri) ? start.uri : batch.owned[0];
        const version = batch.sources.find(item => item.uri === uri).version;
        const result = await request(batch, 'codeActions', {...parameters, uri, version, scope: 'project',
          ownership: batch.ownership}, options);
        return result[0];
      }));
      batches.forEach(verify);
      checkSource(start);
      if (parameters.scope === 'solution' && builds.list().map(item => item.id).sort().join('\n') !== ids) {
        throw new Error('Solution membership changed while preparing Fix All');
      }
      const edit = mergeWorkspaceEdits(results);
      await validateMerged(batches, edit, options);
      checkSource(start);
      if (parameters.scope === 'solution' && builds.list().map(item => item.id).sort().join('\n') !== ids) {
        throw new Error('Solution membership changed while validating Fix All');
      }
      return [{title: `Fix ${edit.edits.length} occurrences in ${parameters.scope}`, kind: 'refactor.rewrite',
        equivalenceKey: parameters.equivalenceKey, scope: parameters.scope, edits: edit.edits}];
    },

    async rename(parameters, options = {}) {
      const start = origin(parameters);
      const first = capture(projects.serviceFor(parameters.uri, parameters.projectId));
      const target = await request(first, 'prepareRename', {...parameters, version: start.version}, options);
      if (!target?.declaration) throw new Error('No bound source declaration to rename');
      const declaration = source(target.declaration.uri);
      const batches = builds.list().map(capture).filter(batch => batch.sources.some(item => item.uri === declaration.uri));
      const ids = builds.list().map(item => item.id).sort().join('\n');
      const results = await Promise.all(batches.map(batch => request(batch, 'rename', {...parameters,
        uri: declaration.uri, version: declaration.version, offset: target.declaration.start}, options)));
      batches.forEach(verify);
      checkSource(start);
      checkSource(declaration);
      if (builds.list().map(item => item.id).sort().join('\n') !== ids) throw new Error('Solution changed while preparing rename');
      const merged = mergeWorkspaceEdits(results);
      await validateMerged(batches, merged, options,
        {uri: declaration.uri, offset: target.declaration.start, newName: parameters.newName});
      checkSource(start);
      if (builds.list().map(item => item.id).sort().join('\n') !== ids) throw new Error('Solution changed while validating rename');
      const groups = new Map();
      for (const edit of merged.edits) {
        if (!groups.has(edit.uri)) groups.set(edit.uri, []);
        groups.get(edit.uri).push(edit);
      }
      return {title: `Rename to ${parameters.newName}`, documentChanges: [...groups].map(([uri, edits]) => ({
        textDocument: {uri, version: edits[0].version}, edits
      })).concat(merged.resources)};
    }
  };
}

/** Shared linked files must receive exactly the same versioned edits from every affected project. */
export function mergeWorkspaceEdits(results) {
  const edits = new Map();
  const resources = new Map();
  for (const result of results) {
    const changes = result?.documentChanges ?? [];
    const values = Array.isArray(result) ? result : result?.edits ?? changes.flatMap(change => change.textDocument ?
      change.edits.map(edit => ({...edit, uri: change.textDocument.uri, version: change.textDocument.version})) : []);
    for (const edit of values) {
      const key = `${edit.uri}:${edit.start}:${edit.end}`;
      const previous = edits.get(key);
      if (previous && (previous.version !== edit.version || previous.newText !== edit.newText)) {
        throw new Error('Projects disagree about an edit to shared source');
      }
      edits.set(key, edit);
    }
    for (const resource of result?.resources ?? changes.filter(change => change.kind)) {
      const previous = resources.get(resource.oldUri);
      if (previous && (previous.newUri !== resource.newUri || previous.version !== resource.version)) {
        throw new Error('Projects disagree about a resource rename');
      }
      resources.set(resource.oldUri, resource);
    }
  }
  const sorted = [...edits.values()].sort((a, b) => a.uri.localeCompare(b.uri) || a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index++) {
    const a = sorted[index - 1], b = sorted[index];
    if (a.uri === b.uri && (b.start < a.end || b.start === a.start)) throw new Error('Project workspace edits overlap');
  }
  return {edits: sorted, resources: [...resources.values()]};
}
