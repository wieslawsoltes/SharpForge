import { GitError, checkCancelled, GIT_WORKER_LIMITS } from '@sharpforge/git';
import { gitElement, gitButton, gitField } from './git-dom.js';
import { runRepositoryTool, formatRepositoryBytes } from './git-repository-tool-actions.js';

export const GIT_ARCHIVE_MAX_BYTES = GIT_WORKER_LIMITS.maxArtifactBytes;
const formats = Object.freeze({ zip: { label: 'ZIP', mime: 'application/zip' }, bundle: { label: 'Bundle', mime: 'application/x-git-bundle' } });

function archiveFormat(format) {
  const selected = formats[format];
  if (!selected) throw new GitError('Unsupported', 'Choose ZIP or Git bundle format.');
  return selected;
}

/** Check size before allocation and again after reading; archive contents are validated by the worker service. */
export async function readGitArchiveFile(file, { signal } = {}) {
  checkCancelled(signal);
  if (!file || typeof file.arrayBuffer !== 'function') throw new GitError('NotFound', 'Choose an archive file.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > GIT_ARCHIVE_MAX_BYTES) {
    throw new GitError('Limit', 'Choose a nonempty archive no larger than 64 MiB.');
  }
  const buffer = await file.arrayBuffer();
  checkCancelled(signal);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size || buffer.byteLength > GIT_ARCHIVE_MAX_BYTES) {
    throw new GitError('Corrupt', 'Archive file length does not match its selected size.');
  }
  return new Uint8Array(buffer);
}

export function importGitArchive(workbench, file, { format, prefix = '', overwrite = false, stage = false,
  updateRefs = false, force = false, signal } = {}) {
  const selected = archiveFormat(format);
  return runRepositoryTool(workbench, { title: `Import ${selected.label}`, signal,
    adopt: format === 'zip', requireClean: format === 'bundle' && updateRefs,
    action: async options => {
      const bytes = await readGitArchiveFile(file, options);
      const params = format === 'zip' ? { bytes, prefix, overwrite: overwrite === true, stage: stage === true }
        : { bytes, updateRefs: updateRefs === true, force: updateRefs === true && force === true };
      return workbench.request(format === 'zip' ? 'importZip' : 'importBundle', params, options);
    },
    describe: result => format === 'zip' ? {
      summary: `${result.files.length} files imported${result.staged ? ' and staged' : ''}.`,
      details: { files: result.files.slice(0, 100), totalFiles: result.files.length, staged: result.staged }
    } : { summary: `${result.pack.count} objects imported${updateRefs ? '; selected bundle references updated' : '; references unchanged'}.`,
      details: { algorithm: result.algorithm, pack: result.pack, refs: result.refs.slice(0, 100), totalRefs: result.refs.length,
        updateRefs: updateRefs === true, worktree: 'Bundle import does not check out files.' } }
  });
}

export function exportGitArchive(workbench, { format, filename, revision = 'HEAD', prefix = '', refs = '', signal } = {}) {
  const selected = archiveFormat(format);
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 180 || /[\x00-\x1f\x7f/\\]/u.test(filename)) {
    throw new GitError('Unsafe', 'Enter a filename without directory separators.');
  }
  if (typeof refs !== 'string' || refs.length > 65536) throw new GitError('Limit', 'Bundle reference selection is too large.');
  const references = [...new Set(refs.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))];
  if (references.length > 1000) throw new GitError('Limit', 'Choose at most 1,000 bundle references.');
  return runRepositoryTool(workbench, { title: `Export ${selected.label}`, signal,
    action: async options => {
      const params = format === 'zip' ? { revision: revision.trim() || 'HEAD', prefix, maxArchiveBytes: GIT_ARCHIVE_MAX_BYTES }
        : { ...(references.length ? { refs: references } : {}), maxBundleBytes: GIT_ARCHIVE_MAX_BYTES };
      const result = await workbench.request(format === 'zip' ? 'exportZip' : 'exportBundle', params, options);
      checkCancelled(options.signal);
      const artifact = await workbench.host.download(filename.trim(), result.bytes, selected.mime, { signal: options.signal });
      if (!artifact) throw new GitError('Cancelled', 'Archive download was cancelled or blocked.');
      return { filename: artifact.name ?? filename.trim(), bytes: artifact.bytes?.byteLength ?? result.bytes.byteLength,
        entries: Array.isArray(result.entries) ? result.entries.length : result.entries,
        objects: result.objects, references: result.refs?.length, algorithm: result.algorithm };
    }, describe: result => ({ summary: `${result.filename} saved (${formatRepositoryBytes(result.bytes)}).`, details: result })
  });
}

function field(document, name, label, options = {}) {
  const input = gitElement(document, options.multiline ? 'textarea' : 'input', {
    name, type: options.type ?? 'text', value: options.value, checked: options.checked,
    required: options.required, accept: options.accept, rows: options.multiline ? 4 : undefined
  });
  return { input, element: gitField(document, label, input) };
}

function showArchiveDialog(document, { title, fields, submitLabel, signal, submit }) {
  checkCancelled(signal);
  const previous = document.activeElement;
  const controller = new AbortController();
  const dialog = gitElement(document, 'dialog', { className: 'git-dialog', 'aria-label': title });
  const status = gitElement(document, 'p', { role: 'alert', className: 'git-error' });
  const button = gitElement(document, 'button', { type: 'submit', text: submitLabel, className: 'git-primary' });
  const close = () => { controller.abort(); dialog.close(); };
  const form = gitElement(document, 'form', {}, gitElement(document, 'h2', { text: title }), fields, status,
    gitElement(document, 'footer', {}, gitButton(document, 'Cancel', close), button));
  let pending = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    pending = true;
    button.disabled = true;
    try { await submit(controller.signal); dialog.close(); }
    catch (error) { status.textContent = error.message; }
    finally { pending = false; button.disabled = false; }
  });
  dialog.addEventListener('cancel', () => controller.abort());
  dialog.addEventListener('close', () => {
    controller.abort();
    signal?.removeEventListener('abort', close);
    for (const input of form.querySelectorAll('input[type="file"]')) input.value = '';
    dialog.remove();
    previous?.focus();
  }, { once: true });
  signal?.addEventListener('abort', close, { once: true });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  form.querySelector('input,textarea')?.focus();
  return dialog;
}

export function showGitArchiveImport(document, workbench, format, { signal } = {}) {
  const selected = archiveFormat(format);
  const file = field(document, 'file', `${selected.label} file (maximum 64 MiB)`, {
    type: 'file', required: true, accept: format === 'zip' ? '.zip,application/zip' : '.bundle,application/x-git-bundle'
  });
  const prefix = field(document, 'prefix', 'Destination directory (optional)');
  const overwrite = field(document, 'overwrite', 'Allow overwriting existing files', { type: 'checkbox' });
  const stage = field(document, 'stage', 'Stage imported files', { type: 'checkbox' });
  const updateRefs = field(document, 'updateRefs', 'Update references from the bundle', { type: 'checkbox' });
  const force = field(document, 'force', 'Allow replacing existing references', { type: 'checkbox' });
  force.input.disabled = true;
  updateRefs.input.addEventListener('change', () => {
    force.input.disabled = !updateRefs.input.checked;
    if (!updateRefs.input.checked) force.input.checked = false;
  });
  const fields = [file.element, ...(format === 'zip' ? [prefix.element, overwrite.element, stage.element]
    : [updateRefs.element, force.element, gitElement(document, 'p', { className: 'git-muted',
      text: 'Bundle references are imported only when selected. Importing a bundle does not check out its files.' })])];
  return showArchiveDialog(document, { title: `Import ${selected.label}`, fields, submitLabel: `Import ${selected.label}`, signal,
    submit: active => importGitArchive(workbench, file.input.files?.[0], { format, prefix: prefix.input.value,
      overwrite: overwrite.input.checked, stage: stage.input.checked, updateRefs: updateRefs.input.checked,
      force: force.input.checked, signal: active }) });
}

export function showGitArchiveExport(document, workbench, format, { signal } = {}) {
  const selected = archiveFormat(format);
  const filename = field(document, 'filename', 'Filename', { value: `${workbench.repositoryId}.${format}`, required: true });
  const revision = field(document, 'revision', 'Revision', { value: 'HEAD', required: true });
  const prefix = field(document, 'prefix', 'Archive directory prefix (optional)');
  const refs = field(document, 'refs', 'Complete reference names (one per line; empty exports all)', { multiline: true });
  return showArchiveDialog(document, { title: `Export ${selected.label}`, submitLabel: `Save ${selected.label}`, signal,
    fields: [filename.element, ...(format === 'zip' ? [revision.element, prefix.element] : [refs.element])],
    submit: active => exportGitArchive(workbench, { format, filename: filename.input.value,
      revision: revision.input.value, prefix: prefix.input.value, refs: refs.input.value, signal: active }) });
}
