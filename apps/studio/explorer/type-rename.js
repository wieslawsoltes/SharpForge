const unavailable = reason => ({available: false, reason, edits: [], documents: [],
  diagnostic: {code: 'SFL2401', severity: 'warning', message: reason}});

/** Scope the worker's semantic preview to a fully loaded single compilation before offering a type rename. */
export async function prepareExplorerTypeRename(context, request, {uri, oldName, newName}) {
  const projects = context.snapshot?.projects ?? [];
  if (context.native) return unavailable('Native type rename needs a semantic reference provider for the native workspace.');
  if (projects.length > 1 || projects.some(project => project.unloaded || project.supported === false)) {
    return unavailable('Type rename needs one fully loaded project; references across separate project compilations are not yet covered.');
  }
  if (projects.some(project => project.targetFrameworks?.length > 1)) {
    return unavailable('Type rename needs one target framework; references in the other compilation contexts are not yet covered.');
  }
  const inputs = projects.length ? projects[0].compile ?? [] : context.records.filter(record => /\.cs$/i.test(record.path));
  const records = new Map(context.records.map(record => [record.path, record]));
  if (inputs.some(input => typeof records.get(input.path)?.text !== 'string')) {
    return unavailable('Load every compilation input before renaming a type; unloaded references cannot be skipped.');
  }
  return request('prepareTypeRename', {uri, offset: null, newName, name: oldName});
}

/** Keep the exact source snapshots in the command read set so a dialog cannot race an editor change. */
export async function typeRenameOperations(commands, plan) {
  if (!Array.isArray(plan.edits) || !Array.isArray(plan.documents)) throw new Error('Type rename provider returned an invalid edit plan');
  const byUri = new Map();
  for (const edit of plan.edits) {
    const entries = byUri.get(edit.uri) ?? [];
    entries.push(edit);
    byUri.set(edit.uri, entries);
  }
  const operations = [];
  const covered = new Set();
  for (const document of plan.documents) {
    const current = await commands.readText(document.uri);
    if (current !== document.text) throw new Error('Source changed while preparing type rename: ' + document.uri);
    const edits = (byUri.get(document.uri) ?? []).sort((left, right) => right.start - left.start);
    covered.add(document.uri);
    let text = document.text;
    let previous = text.length;
    for (const edit of edits) {
      if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end > previous ||
        edit.end < edit.start || typeof edit.newText !== 'string') throw new Error('Type rename provider returned overlapping or invalid edits');
      text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
      previous = edit.start;
    }
    if (edits.length) operations.push({kind: 'write', path: document.uri, text});
  }
  if (plan.edits.some(edit => !covered.has(edit.uri))) {
    throw new Error('Type rename provider omitted a source snapshot');
  }
  return operations;
}
