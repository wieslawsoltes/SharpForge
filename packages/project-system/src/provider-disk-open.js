import {decodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemAccessProvider} from '@sharpforge/workspace';
import {WorkspaceImportReport} from './import-report.js';
import {scanDirectory, DISK_WORKSPACE_LIMITS, checkDiskCancelled} from './disk-scan.js';
import {ProviderDiskWorkspace} from './provider-disk-workspace.js';
import {isProjectEvaluationInput} from './disk-inputs.js';

/** FileList import preserves unknown bytes and exposes every rejected path in an import report. */
export async function readProviderFiles(files, options = {}) {
  const limits = {...DISK_WORKSPACE_LIMITS, ...options};
  const list = [...files];
  if (list.length > limits.maxFiles) throw new RangeError('Disk workspace file limit exceeded');
  const records = [];
  const folders = new Set();
  const report = new WorkspaceImportReport(options);
  let total = 0;
  for (const file of list) {
    checkDiskCancelled(options.signal);
    const raw = file.webkitRelativePath || file.name;
    const administrative = /(?:^|\/)\.sharpforge\/workspace\.json$/.test(raw);
    const path = report.admit(raw, {administrative});
    if (!path) continue;
    const maximum = /\.(?:dll|exe|pdb)$/i.test(path) ? limits.maxAssemblyBytes : limits.maxFileBytes;
    if (file.size > maximum) { report.skip(path, 'file-too-large', `${file.size} bytes exceeds ${maximum}`); continue; }
    if (total + file.size > limits.maxTotalBytes) throw new RangeError('Disk workspace byte limit exceeded by ' + path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    checkDiskCancelled(options.signal);
    if (bytes.length !== file.size) throw new Error('File changed while being read: ' + path);
    total += bytes.length;
    records.push(decodeWorkspaceFile(path, bytes));
    let parent = path;
    while (parent.includes('/')) { parent = parent.slice(0, parent.lastIndexOf('/')); folders.add(parent); }
  }
  Object.defineProperties(records, {folders: {value: [...folders]}, skipped: {value: report.skipped}, importReport: {value: report.summary()}});
  return records;
}

/** Large folders enumerate metadata first; only project files and explicitly opened paths materialize bytes. */
export async function readProviderDirectory(handle, options = {}) {
  const provider = options.provider ?? new FileSystemAccessProvider(handle, {caseSensitive: options.caseSensitive ?? false,
    maxFileBytes: Math.max(options.maxFileBytes ?? DISK_WORKSPACE_LIMITS.maxFileBytes,
      options.maxAssemblyBytes ?? DISK_WORKSPACE_LIMITS.maxAssemblyBytes)});
  let gitignore = options.gitignore;
  if (options.applyGitignore && gitignore === undefined) {
    try { gitignore = new TextDecoder('utf-8', {fatal: true}).decode(await provider.readFile('.gitignore', options)); }
    catch (error) { if (error.code !== 'NotFound') throw error; gitignore = ''; }
  }
  const scanned = await scanDirectory(provider, {...options, gitignore});
  const {records, folders, report, limits} = scanned;
  const skipped = report.skipped.map(outcome => outcome.reason === 'ignored-folder' ? outcome.path : outcome);
  const disk = new ProviderDiskWorkspace(records, new Map(), handle.name, folders, skipped, {...options, rootHandle: handle, provider, report});
  const lazy = options.lazy ?? records.length > limits.eagerThreshold;
  const opened = new Set(options.openedPaths ?? []);
  for (const record of records.slice()) {
    checkDiskCancelled(options.signal);
    if (lazy && !isProjectEvaluationInput(record.path) && !opened.has(record.path)) continue;
    try { await disk.load(record.path, options); }
    catch (error) {
      if (!['FileTooLarge', 'QuotaExceeded'].includes(error.code)) throw error;
      const outcome = report.skip(record.path, error.code === 'FileTooLarge' ? 'file-too-large' : 'loaded-byte-budget', error.message);
      skipped.push(outcome);
    }
  }
  checkDiskCancelled(options.signal);
  disk.lazy = lazy;
  return disk;
}
