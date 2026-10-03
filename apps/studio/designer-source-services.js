/** Select the owning project without changing Studio's startup-project or compiler-workspace selection. */
export function designerCompilationContext(state, uri) {
  const system = state.projectSystem;
  let project = state.startupProject;
  let included = project && system ? system.compilationFiles(project) : null;
  if (system && (!included || !included.some(file => file.uri === uri))) {
    const matches = [...system.projects.keys()].filter(path => system.compilationFiles(path).some(file => file.uri === uri));
    matches.sort((left, right) => right.length - left.length);
    project = matches[0] ?? null;
    included = project ? system.compilationFiles(project) : null;
  }
  const uris = included ? new Set(included.map(file => file.uri)) : null;
  return {
    files: state.files.filter(file => !uris || uris.has(file.uri)).map(file => ({...file})),
    revision: state.revision, assemblyName: state.name, extensions: state.extensionConfig,
    compilationOptions: project && system ? system.compilationOptions(project) : {outputKind: 'library', langVersion: state.langVersion}
  };
}

function assertPlanCurrent(state, uri, plan, version) {
  if (state.readOnly) throw new Error('Begin Edit and Continue before changing C#');
  if (plan.workspaceRevision !== undefined && state.revision !== plan.workspaceRevision) {
    throw new Error('Workspace changed while validating the designer transaction');
  }
  const files = new Map(state.files.map(file => [file.uri, file]));
  if (files.get(uri)?.version !== version) throw new Error('Linked source changed before the designer transaction');
  for (const expected of plan.expectedSources ?? []) {
    const file = files.get(expected.uri);
    if (!file || file.text !== expected.text || file.version !== expected.version) {
      throw new Error('Designer dependency changed: ' + expected.uri);
    }
  }
  return files;
}

function planEdits(changes, files) {
  const edits = [];
  for (const change of changes) {
    const file = files.get(change.uri);
    if (!file || file.text !== change.before || file.version !== change.expectedVersion || file.readOnly || file.readonly) {
      throw new Error('Cannot apply changed or read-only source: ' + change.uri);
    }
    let end = 0;
    for (const edit of [...change.edits].sort((left, right) => left.start - right.start)) {
      if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || edit.start < end || edit.end < edit.start ||
        edit.end > file.text.length || typeof edit.text !== 'string') throw new Error('Invalid designer source edit');
      end = edit.end;
      edits.push({uri: change.uri, start: edit.start, end: edit.end, newText: edit.text, version: file.version});
    }
    let candidate = file.text;
    for (const edit of [...change.edits].sort((left, right) => right.start - left.start || right.end - left.end)) {
      candidate = candidate.slice(0, edit.start) + edit.text + candidate.slice(edit.end);
    }
    if (candidate !== change.text) throw new Error('Designer patch does not reproduce its compiled source candidate');
  }
  return edits;
}

/** All affected source buffers commit together only after the complete candidate compiled in the worker. */
export function createDesignerSourceServices({state, compiler, applyEdits, documents, history, projectTypes = () => []}) {
  const analyzeDesign = async params => {
    const {signal, ...request} = params;
    const context = designerCompilationContext(state, params.uri);
    const result = await compiler.request('designAnalyze', {...context, ...request,
      projectTypes: request.projectTypes ?? projectTypes()}, {signal});
    return {...result, workspaceRevision: context.revision};
  };
  const applySourceEdits = async (uri, plan, version, beforeApply = () => {}, ownerUri = uri) => {
    if (plan.success === false) throw new Error('The source candidate did not compile');
    const files = assertPlanCurrent(state, uri, plan, version);
    const changes = plan.changes ?? [{uri, before: files.get(uri).text, text: plan.text, expectedVersion: version, edits: plan.edits}];
    const edits = planEdits(changes, files);
    if (!edits.length) return;
    if (plan.success !== true) {
      const context = designerCompilationContext(state, uri);
      await compiler.request('validateDesigner', {...context, action: {title: 'Synchronize designer', edits}});
      assertPlanCurrent(state, uri, {...plan, workspaceRevision: context.revision}, version);
    }
    beforeApply();
    const beforeAnalysis = documents().get(ownerUri)?.sourceSync?.session?.analysis;
    const beforeEditors = history.capture(changes);
    applyEdits(edits);
    history.record({uri: ownerUri, changes, beforeAnalysis, afterAnalysis: plan.analysis, beforeEditors});
  };
  return {
    analyzeDesign,
    applySourceEdits,
    editSourceText(uri, text, version) {
      const file = state.files.find(item => item.uri === uri);
      if (!file || file.version !== version) throw new Error('Source changed');
      if (state.readOnly) throw new Error('Begin Edit and Continue before changing C#');
      applyEdits([{uri, start: 0, end: file.text.length, newText: text, version}]);
    }
  };
}
