export const MAX_EAGER_EXPLORER_ENTRIES = 2000;

function largeHierarchy(data) {
  const files = data.records ?? data.files ?? [];
  if (files.length + (data.folders?.length ?? 0) > MAX_EAGER_EXPLORER_ENTRIES) return true;
  const projects = data.snapshot?.projects ?? [];
  let entries = projects.length + (data.generated?.length ?? 0) + (data.snapshot?.solution?.items?.length ?? 0);
  if (entries > MAX_EAGER_EXPLORER_ENTRIES) return true;
  for (const project of projects) {
    entries += Math.max(project.compile?.length ?? 0, project.items?.length ?? 0);
    entries += (project.generatedDocuments ?? project.generatedSources ?? []).length;
    entries += (project.importRecords ?? project.imports ?? []).length;
    if (entries > MAX_EAGER_EXPLORER_ENTRIES) return true;
  }
  return false;
}

/** Resolve presentation from metadata counts without traversing file or item records. Saved preferences remain unchanged. */
export function explorerViewPolicy(data, requestedView = 'solution') {
  const large = largeHierarchy(data);
  const lazy = large || (!!data.disk?.lazy && (requestedView === 'folders' || !data.snapshot));
  return {
    view: lazy ? 'folders' : requestedView,
    lazy,
    large,
    reason: large ? 'Large workspace: files are shown in paged Folder view. Solution hierarchy is available in smaller scopes.' : null
  };
}
