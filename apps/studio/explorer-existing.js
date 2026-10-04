import { decodeWorkspaceFile, encodeWorkspaceFile } from '@sharpforge/archive';
import { editProjectMembership, validateItemPath } from '@sharpforge/project-system';
import { readStudioSource } from './workbench/studio-source-reader.js';
import { studioDiskLimits } from './workbench/workspace-limits.js';
import { explorerSource } from './explorer-records.js';
import { releaseExplorerModels } from './explorer-history.js';

const NATIVE_ITEM_BYTES = 16 * 1024 * 1024;

function base64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}

function checkCurrent(owner, identity) {
  if (owner.operationController?.signal.aborted || owner.host.context().identity !== identity) {
    throw new DOMException('Workspace changed or existing-item import was cancelled', 'AbortError');
  }
}

/** Browser sources use the shared chunk decoder. The native mutation protocol retains its explicit 16 MiB binary payload bound. */
export async function addExistingExplorerItems(owner, node, context) {
  const files = await owner.host.pickFiles();
  if (!files?.length) return;
  if (files.length > studioDiskLimits.maxFiles) throw new RangeError('Existing item count limit exceeded');
  const folder = owner.folder(node);
  const plans = [];
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    const path = validateItemPath((folder ? folder + '/' : '') + file.name);
    const key = path.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate existing item path: ' + path);
    seen.add(key);
    const maximum = context.native ? NATIVE_ITEM_BYTES : studioDiskLimits.maxFileBytes;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximum) {
      throw new RangeError(context.native ? 'Native existing items must be at most 16 MiB each' : 'Existing item byte limit exceeded');
    }
    total += file.size;
    if (total > studioDiskLimits.maxTotalBytes) throw new RangeError('Existing item total byte limit exceeded');
    plans.push({ file, path });
  }
  const models = new Set();
  const operations = [];
  let committed = false;
  try {
    checkCurrent(owner, context.identity);
    let projectText = node?.project ? await owner.readText(node.project) : null;
    for (const { file, path } of plans) {
      checkCurrent(owner, context.identity);
      if (context.native) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== file.size) throw new Error('Existing item changed while reading: ' + path);
        operations.push({ kind: 'create', path, base64: base64(bytes) });
      } else {
        let record;
        if (/\.cs$/i.test(path)) {
          record = await (owner.host.readSource ?? readStudioSource)(file, {
            path, signal: owner.operationController?.signal, limits: studioDiskLimits,
            onProgress: progress => {
              checkCurrent(owner, context.identity);
              owner.host.onFileProgress?.(path, progress);
            }
          });
          if (record.model) models.add(record.model);
        } else {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (bytes.length !== file.size) throw new Error('Existing item changed while reading: ' + path);
          record = decodeWorkspaceFile(path, bytes);
        }
        operations.push({ kind: 'create', path, record });
      }
      checkCurrent(owner, context.identity);
      if (projectText !== null) projectText = editProjectMembership(projectText, {
        projectPath: node.project, path, itemType: /\.cs$/i.test(path) ? 'Compile' : 'None'
      });
    }
    if (projectText !== null) operations.push({ kind: 'write', path: node.project, text: projectText });
    await owner.perform(operations);
    committed = true;
  } catch (error) {
    committed = error.committed === true;
    throw error;
  }
  finally { releaseExplorerModels(owner, models, { committed, records: operations.map(operation => operation.record).filter(Boolean) }); }
}

/** Convert an explicit prepared operation only at the bounded native protocol boundary. */
export function nativeExplorerOperation(operation) {
  const { record, ...result } = operation;
  if (!record) return result;
  const source = explorerSource(record);
  if (source && source.length > NATIVE_ITEM_BYTES) throw new RangeError('Native source operation exceeds the 16 MiB payload limit');
  if (operation.kind === 'write') {
    const text = source ? source.getText(0, source.length) : record.text;
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 4 * 1024 * 1024) {
      throw new RangeError('Native text operations support at most 4 MiB');
    }
    return { ...result, text };
  }
  if (operation.kind !== 'create') throw new TypeError('Only create/write operations accept prepared records');
  const bytes = !source && record.bytes ? record.bytes : encodeWorkspaceFile({
    path: operation.path, text: source ? source.getText(0, source.length) : record.text, encoding: record.encoding, bom: record.bom
  });
  if (bytes.length > NATIVE_ITEM_BYTES) throw new RangeError('Native existing items must be at most 16 MiB each');
  return { ...result, base64: base64(bytes) };
}
