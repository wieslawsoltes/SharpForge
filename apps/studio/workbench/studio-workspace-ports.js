import {
  addSolutionProject, convertLegacySolution, exportWorkspaceZip, isTextRecord,
  workspaceManifestRecord, writeNewDirectory
} from '@sharpforge/project-system';
import {createWorkspaceSession} from '../workspace-session.js';
import {applyExternalDiskChange, reevaluateDiskWorkspace} from '../workspace-disk-events.js';
import {commitWorkspaceWizard} from '../workspace-wizard.js';
import {exportWorkspaceToWritable} from '../workspace-export.js';
import {createLegacyWorkspaceBundle} from '../workspace-bundle.js';
import {restoreLegacyWorkspace} from '../workspace-recovery.js';
import {promptWorkspaceSaveConflict} from '../workspace-save-conflict.js';
import {importStudioExistingProject} from './studio-existing-project.js';
import {openStudioWorkspaceZip} from './studio-file-import.js';
import {studioSourceRecord} from './studio-source-records.js';

function sameWorkspace(left, right) {
  return left.identity === right.identity && left.revision === right.revision && left.disk === right.disk;
}

/** Compose existing workspace services with the document owner. Construction neither loads nor saves a workspace. */
export function createStudioWorkspacePorts(host) {
  return new StudioWorkspacePorts(host);
}

class StudioWorkspacePorts {
  constructor(host) {
    this.host = host;
    this.sessionInstance = null;
    this.workspaceActions = new Map([
      ['reopen-recent-workspace', (node, payload) => this.session().reopenRecent(node?.recent ?? payload.recent)],
      ['disk-external-change', (_node, payload) => applyExternalDiskChange(host, this.session(), payload)],
      ['disk-reevaluate', (_node, payload) => reevaluateDiskWorkspace(host, this.session(), payload)],
      ['save-zip', () => this.exportZip()], ['save-folder', () => this.saveFolder()],
      ['open-workspace-entry', node => this.openEntry(node)], ['convert-sln', node => this.convertSolution(node)],
      ['import-project', () => this.importExistingProject()]
    ]);
  }

  session() {
    const host = this.host;
    const {documents, nativeBuild, docking, projectWizard} = host;
    return this.sessionInstance ??= createWorkspaceSession({
      ...host,
      editors: documents.editors,
      workbench: () => ({...host.workbench(), workspaceSettings: host.settings}),
      hasNativeChanges: () => host.nativeSourceChanges().length || nativeBuild.sourceChanges().length,
      selectImport: (records, options) => projectWizard.selectImport(records, options),
      revokeRuntime: () => host.runtimeTools.revoke(),
      renderProject: () => host.renderPanel('project'),
      ready: text => {
        host.status(text);
        host.renderTree();
      },
      persistenceReady: () => host.explorer.persistence.ready(),
      isDocumentOpen: path => [...docking.tabs.views].some(([id, view]) => view.uri === path &&
        (docking.host.popouts.has(id) || docking.layout.locate(id).kind !== 'closed')),
      canReleaseDocument: path => host.explorer.canReleaseDocument(path),
      releaseDocumentCaches: path => host.explorer.releaseDocument(path),
      releaseCompilerDocuments: records => host.compiler.request('releaseDocuments', {documents: records}),
      renderDocuments: () => {
        host.renderTabs();
        host.renderTree();
        host.renderBreadcrumb();
      },
      chooseSaveConflict: conflict => promptWorkspaceSaveConflict(host, conflict)
    });
  }

  async ensureSource(uri, {signal} = {}) {
    const {host} = this;
    const {state, documents, nativeBuild} = host;
    signal?.throwIfAborted();
    const present = documents.get(uri);
    if (present) return present;
    const before = host.context();
    if (state.nativeMode) {
      await nativeBuild.open(uri);
      signal?.throwIfAborted();
      return documents.get(uri);
    }
    const record = await this.session().loadRecord(uri, {signal});
    signal?.throwIfAborted();
    if (!sameWorkspace(before, host.context())) throw new Error('Workspace changed while opening source: ' + uri);
    if (!/\.cs$/i.test(uri) || !isTextRecord(record)) throw new Error('Source is unavailable: ' + uri);
    const source = documents.add(studioSourceRecord(record), {signal});
    host.renderWorkspace();
    return source;
  }

  async recover() {
    const {host} = this;
    const result = await restoreLegacyWorkspace({
      storage: host.storage, key: host.storageKey, session: this.session(),
      onDiagnostic: diagnostic => host.toast(diagnostic.message, 'error')
    });
    return result.restored || result.blocked;
  }

  async exportLegacy() {
    const {host} = this;
    const {state} = host;
    const snapshot = await this.session().snapshot();
    host.download(state.name + '.sharpforge.json', createLegacyWorkspaceBundle(snapshot));
    host.toast('Workspace exported with original file encodings and hierarchy.');
  }

  async zipBytes() {
    return exportWorkspaceZip(await this.session().snapshot());
  }

  async exportZip() {
    const {host} = this;
    const {state} = host;
    if (typeof host.window.showSaveFilePicker === 'function') {
      let handle;
      try {
        handle = await host.window.showSaveFilePicker({
          suggestedName: state.name + '.zip',
          types: [{description: 'Workspace ZIP', accept: {'application/zip': ['.zip']}}]
        });
      } catch (error) {
        if (error.name === 'AbortError') return null;
        throw error;
      }
      const context = host.context();
      const writable = await handle.createWritable();
      const result = await exportWorkspaceToWritable(context, writable, {
        isCurrent: () => sameWorkspace(context, host.context())
      });
      host.toast('Workspace ZIP saved with original file bytes and settings.');
      return result;
    }
    const bytes = await this.zipBytes();
    host.download(state.name + '.zip', bytes, 'application/zip');
    host.toast('Workspace ZIP saved with original file bytes and settings.');
    return bytes;
  }

  async saveFolder() {
    const {host} = this;
    if (typeof host.window.showDirectoryPicker !== 'function') {
      throw new Error('This browser does not expose writable directory handles. Save as ZIP and extract it instead.');
    }
    let handle;
    try {
      handle = await host.window.showDirectoryPicker({mode: 'readwrite'});
    } catch (error) {
      if (error.name === 'AbortError') return null;
      throw error;
    }
    const snapshot = await this.session().snapshot();
    try {
      const result = await writeNewDirectory(handle, {
        ...snapshot, records: [...snapshot.records, workspaceManifestRecord(snapshot.settings, snapshot.records)]
      });
      host.toast('Saved ' + result.written.length + ' files to the empty destination folder.');
      return result;
    } catch (error) {
      host.toast(error.message + (error.written?.length ? ' Completed files: ' + error.written.join(', ') : ''), 'error');
      throw error;
    }
  }

  async prepareWizard(node) {
    const {host} = this;
    const {state, nativeBuild} = host;
    if (state.readOnly) throw new Error('Stop debugging before creating files');
    if (!state.nativeMode) return;
    const context = host.context();
    const paths = [node?.project, node?.kind === 'project' ? node.path : null, context.startup, context.solutionPath];
    for (const path of new Set(paths.filter(Boolean))) {
      if (nativeBuild.buffers.has(path)) continue;
      const file = await nativeBuild.client.read(path);
      nativeBuild.buffers.set(path, {...file, baseline: file.text});
    }
  }

  async openProject({add = false, node = null} = {}) {
    await this.prepareWizard(node);
    return this.host.projectWizard.openProject({add, node});
  }

  async openItem(node = null) {
    await this.prepareWizard(node);
    return this.host.projectWizard.openItem(node);
  }

  commitWizard(plan, options) {
    const {host} = this;
    const {state, actions, nativeBuild, docking} = host;
    return commitWorkspaceWizard({
      state, actions, nativeBuild, context: host.context, confirm: host.confirm,
      load: host.load, commit: host.commit, open: host.open, render: host.renderTree,
      save: host.saveLocal, log: host.log, layout: profile => docking.reset(profile)
    }, plan, options);
  }

  async openEntry(node) {
    const {host} = this;
    const {state, nativeBuild} = host;
    const context = host.context();
    if (!context.records.some(record => record.path === node.path)) throw new Error('Project/solution file is not present');
    if (state.nativeMode) {
      nativeBuild.settings.project = node.path;
      return nativeBuild.open(node.path);
    }
    return host.load(context.records, {entry: node.path, folders: state.folders, name: node.label, disk: state.disk});
  }

  async convertSolution(node) {
    const {host} = this;
    const {actions} = host;
    const text = await actions.readText(node.path);
    const converted = convertLegacySolution(text, node.path);
    await actions.perform([{kind: 'create', path: converted.path, text: converted.text}]);
    host.toast(converted.warnings.join(' ') || 'Created SLNX; original SLN retained.');
  }

  async importExistingProject() {
    const {host} = this;
    const {documents, actions} = host;
    const context = host.context();
    if (!context.solutionPath) throw new Error('Open a .slnx solution before adding an external project');
    const source = await host.ask('Add Existing Project',
      '<p>Keep all project sources, imports, references and assets together.</p>' +
      '<label class="tool-field">Source<select id="existing-source">' +
      '<option value="current">Project already in this workspace</option>' +
      '<option value="zip">Import a project or solution ZIP</option>' +
      '<option value="folder">Import a containing folder</option></select></label>',
      'Choose', () => host.query('#existing-source').value);
    if (!source) return;
    if (source === 'current') {
      const listed = context.snapshot?.solution?.projectPaths ?? [];
      const choices = context.records.filter(record => record.path.endsWith('.csproj') && !listed.includes(record.path))
        .map(record => record.path);
      if (!choices.length) throw new Error('No unlisted project files; import a ZIP or folder first');
      const path = await host.choose('Add Existing Project', choices);
      if (path) {
        const text = await actions.readText(context.solutionPath);
        await actions.perform([{kind: 'write', path: context.solutionPath,
          text: addSolutionProject(text, {solutionPath: context.solutionPath, projectPath: path})}]);
      }
      return;
    }
    const files = await new Promise(resolve => {
      const input = host.document.createElement('input');
      input.type = 'file';
      input.multiple = source === 'folder';
      if (source === 'zip') input.accept = '.zip';
      else input.webkitdirectory = true;
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve([]);
      input.click();
    });
    if (!files.length) return;
    const result = await importStudioExistingProject(files, source, {
      workspace: context, current: host.context, documents, explorer: actions,
      choose: host.choose, pathDialog: host.pathDialog
    });
    if (result) host.toast('Imported ' + result.count + ' files; selected project added to the solution.');
  }

  async previewFile(path) {
    const {host} = this;
    const {state} = host;
    if (!state.nativeMode) await this.session().loadRecord(path);
    const context = host.context();
    const bytes = context.native ? await context.client.binary(path) : context.records.find(record => record.path === path)?.bytes;
    if (!bytes) throw new Error('File bytes unavailable');
    const image = /\.(png|jpe?g|gif|webp)$/i.test(path);
    const url = image ? URL.createObjectURL(new Blob([bytes])) : null;
    const escape = host.escapeHtml;
    const preview = url
      ? `<img src="${escape(url)}" alt="${escape(path)}" style="max-width:100%;max-height:55vh">`
      : `<pre>${Array.from(bytes.slice(0, 256), value => value.toString(16).padStart(2, '0')).join(' ')}${bytes.length > 256 ? ' …' : ''}</pre>`;
    host.showModal(path, `<p>${bytes.length.toLocaleString()} bytes. Previewing does not execute this file.</p>${preview}`, {
      footer: '<button id="download-workspace-file">Save file</button><button id="modal-done">Close</button>',
      onClose: () => { if (url) URL.revokeObjectURL(url); }
    });
    host.query('#download-workspace-file').onclick = () => host.download(path.split('/').at(-1), bytes, 'application/octet-stream');
  }

  action(id, node, payload = {}) {
    return this.workspaceActions.get(id)?.(node, payload);
  }

  openZip(file, options = {}) {
    return openStudioWorkspaceZip(file, options, this.host.importContext());
  }
}
