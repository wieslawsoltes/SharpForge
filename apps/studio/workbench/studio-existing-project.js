import { importWorkspaceZip, prefixWorkspace, addSolutionProject } from '@sharpforge/project-system';
import { rebaseEditorSource } from '@sharpforge/editor';
import { validateFilePlan } from '@sharpforge/templates';
import { readStudioFiles } from './source-imports.js';
import { releaseStudioSources } from './studio-source-records.js';

/** Import complete project records without flattening prepared sources; cancellation releases every unadopted model. */
export async function importStudioExistingProject(files, source, context) {
  const prepared = [];
  try {
    let imported;
    if (source === 'zip') {
      if (files[0].size > 160 * 1024 * 1024) throw new Error('ZIP exceeds the 160 MiB input limit');
      imported = importWorkspaceZip(new Uint8Array(await files[0].arrayBuffer()));
    } else {
      const records = await readStudioFiles(files);
      imported = { records, folders: records.folders ?? [] };
    }
    prepared.push(...imported.records);
    const projects = imported.records.filter(record => record.path.endsWith('.csproj')).map(record => record.path);
    if (!projects.length) throw new Error('No C# project in the imported root');
    const project = await context.choose('Select Existing Project', projects);
    if (!project) return null;
    const prefix = await context.pathDialog('Destination folder for imported files', 'Imported');
    if (!prefix) return null;
    if (context.current().identity !== context.workspace.identity) throw new Error('Workspace changed during import');
    const merged = prefixWorkspace(imported.records, imported.folders, prefix, { rebaseSource: rebaseEditorSource });
    prepared.push(...merged.records);
    validateFilePlan(merged, context.workspace.records);
    const path = context.workspace.solutionPath;
    const text = await context.explorer.readText(path);
    const next = addSolutionProject(text, { solutionPath: path, projectPath: prefix + '/' + project });
    const operations = merged.records.map(record => ({ kind: 'create', path: record.path, record }));
    for (const folder of merged.folders) if (!merged.records.some(record => record.path.startsWith(folder + '/'))) {
      operations.push({ kind: 'mkdir', path: folder });
    }
    operations.push({ kind: 'write', path, text: next });
    await context.explorer.perform(operations);
    return { count: merged.records.length, project: prefix + '/' + project };
  } finally { releaseStudioSources(prepared, context.documents); }
}
