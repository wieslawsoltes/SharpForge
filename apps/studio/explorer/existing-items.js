import {decodeWorkspaceFile} from '@sharpforge/archive';
import {addSolutionItem, editProjectMembership, validateItemPath} from '@sharpforge/project-system';
import {ExplorerPathIndex} from '../explorer-path-index.js';
import {releaseExplorerModels} from '../explorer-history.js';
import {readStudioSource} from '../workbench/studio-source-reader.js';
import {studioDiskLimits} from '../workbench/workspace-limits.js';
import {copyDestination} from './clipboard.js';
import {destinationFolder} from './guards.js';
import {assertExplorerOperationCurrent, explorerOperationSignal} from './prepared-operations.js';

const nativeItemBytes = 16 * 1024 * 1024;

function planExistingItems(context, node, files) {
  const selected = [...files];
  if (selected.length + context.records.length > studioDiskLimits.maxFiles) throw new RangeError('Existing item count limit exceeded');
  const maximum = context.native ? nativeItemBytes : studioDiskLimits.maxFileBytes;
  const folder = destinationFolder(node);
  const occupied = new Set([...context.records.map(record => record.path), ...(context.folders ?? [])]);
  const paths = new ExplorerPathIndex(context.records.map(record => record.path), context.folders ?? []);
  let total = 0;
  return selected.map(file => {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximum) {
      throw new RangeError(context.native ? 'Native existing items must be at most 16 MiB each' : 'Existing item byte limit exceeded');
    }
    total += file.size;
    if (total > studioDiskLimits.maxTotalBytes) throw new RangeError('Existing item total byte limit exceeded');
    const proposed = validateItemPath((folder ? folder + '/' : '') + file.name);
    const path = copyDestination(proposed, occupied);
    paths.assertAvailable(path);
    paths.add(path, true);
    occupied.add(path);
    return {file, path};
  });
}

async function readExistingItem(commands, context, plan, signal) {
  const {file, path} = plan;
  if (!context.native && /\.cs$/i.test(path)) {
    return (commands.host.readSource ?? readStudioSource)(file, {
      path, signal, limits: studioDiskLimits,
      onProgress: progress => {
        assertExplorerOperationCurrent(commands, context.identity, signal);
        commands.host.onFileProgress?.(path, progress);
      }
    });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('External file changed during import: ' + file.name);
  return decodeWorkspaceFile(path, bytes);
}

/** Admit the complete batch before reading; prepared source ownership transfers only after the journal host commit. */
export async function importExplorerFiles(commands, node, files) {
  const context = commands.context();
  const plans = planExistingItems(context, node, files);
  const signal = explorerOperationSignal(commands);
  const models = new Set();
  const operations = [];
  let committed = false;
  try {
    assertExplorerOperationCurrent(commands, context.identity, signal);
    let projectText = node?.project ? await commands.readText(node.project) : null;
    let solutionText = node?.kind === 'solution-folder' && context.solutionPath ? await commands.readText(context.solutionPath) : null;
    for (const plan of plans) {
      assertExplorerOperationCurrent(commands, context.identity, signal);
      const record = await readExistingItem(commands, context, plan, signal);
      if (record.model) models.add(record.model);
      assertExplorerOperationCurrent(commands, context.identity, signal);
      operations.push({kind: 'create', path: plan.path, record});
      if (projectText !== null) projectText = editProjectMembership(projectText,
        {projectPath: node.project, path: plan.path, itemType: /\.cs$/i.test(plan.path) ? 'Compile' : 'None'});
      if (solutionText !== null) solutionText = addSolutionItem(solutionText,
        {solutionPath: context.solutionPath, path: plan.path, folder: node.solutionFolder ?? 'Solution Items'});
    }
    if (projectText !== null) operations.push({kind: 'write', path: node.project, text: projectText});
    if (solutionText !== null) operations.push({kind: 'write', path: context.solutionPath, text: solutionText});
    if (operations.length) await commands.perform(operations, [], {signal});
    committed = true;
    return {imported: plans.length};
  } catch (error) {
    committed = error.committed === true;
    throw error;
  } finally {
    releaseExplorerModels(commands, models, {committed, records: operations.map(operation => operation.record).filter(Boolean)});
  }
}
