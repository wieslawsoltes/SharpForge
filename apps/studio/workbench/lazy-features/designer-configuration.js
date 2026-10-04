import { normalizePath, validateItemPath } from '@sharpforge/project-system';

/** Designer services are supplied at activation; source mutations keep the workspace/version guards. */
export function designerConfiguration(context) {
  const { state, docking, runtime, toast, download, explorerContext, chooseExplorer, openFile, applyEdits,
    requestCompiler, renderTree, saveLocal, loadDiskRecords, launch } = context;
  return {
    state, docking, request: (...args) => runtime.request(...args), toast, download,
    records: () => explorerContext().records, choose: chooseExplorer, sourceFiles: () => state.files, openSource: openFile,
    editSourceText(uri, text, version) {
      const file = state.files.find(item => item.uri === uri);
      if (!file || file.version !== version) throw new Error('Source changed');
      if (state.readOnly) throw new Error('Begin Edit and Continue before editing');
      applyEdits([{ uri, start: 0, end: file.text.length, newText: text, version }]);
    },
    async applySourceEdits(uri, plan, version, beforeApply) {
      if (state.readOnly) throw new Error('Begin Edit and Continue before editing');
      const revision = state.revision;
      const edits = plan.edits.map(edit => ({ uri, start: edit.start, end: edit.end, newText: edit.text, version }));
      if (state.files.find(file => file.uri === uri)?.version !== version) throw new Error('Source changed before validation');
      await requestCompiler('validateDesigner', { action: { title: 'Synchronize design to C#', edits } });
      if (state.revision !== revision || state.files.find(file => file.uri === uri)?.version !== version) {
        throw new Error('Workspace changed while validating designer changes');
      }
      beforeApply();
      applyEdits(edits);
    },
    async saveDocument(path, text) {
      path = normalizePath(path);
      validateItemPath(path);
      if (!path.endsWith('.sfdesign.json')) throw new Error('Design documents must use .sfdesign.json');
      if (state.nativeMode) throw new Error('Export the design JSON for native workspaces. Browser workspace saving never writes native disk files.');
      const existing = explorerContext().records.find(file => file.path === path);
      if (existing?.bytes && !existing.text) throw new Error('Refusing to overwrite a binary asset');
      const record = { ...existing, path, text };
      delete record.bytes;
      if (state.projectSystem) state.projectSystem.files.set(path, record);
      else {
        state.extraFiles = state.extraFiles.filter(file => file.path !== path);
        state.extraFiles.push(record);
      }
      state.dirtyFiles.add(path);
      state.membershipDirty = true;
      state.diskRevision++;
      state.revision++;
      renderTree();
      saveLocal();
    },
    async createWorkspace(records) {
      const message = 'Build this design as a new browser C# workspace? The current workspace is saved to local recovery. Export a ZIP to keep a copy.';
      if (!globalThis.confirm(message)) throw new Error('Build design cancelled');
      saveLocal();
      await loadDiskRecords(records, { entry: 'DesignerApp.slnx', name: 'DesignerApp' });
    },
    runApplication: () => launch(false)
  };
}
