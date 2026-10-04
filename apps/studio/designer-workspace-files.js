import {normalizePath, validateItemPath} from '@sharpforge/project-system';
import {validateDesign, createDesign} from '@sharpforge/designer';

/** Design JSON is a workspace document with the same tab identity and export/recovery lifecycle as source. */
export function createDesignerFileServices(context) {
  const {state, records, renderTree, saveLocal} = context;
  const saveDocument = async (requestedPath, text) => {
    const path = normalizePath(requestedPath);
    validateItemPath(path);
    if (!path.endsWith('.sfdesign.json')) throw new Error('Design documents must use .sfdesign.json');
    validateDesign(JSON.parse(text));
    if (state.nativeMode) throw new Error('Use Export JSON to save a design from a native workspace');
    const existing = records().find(file => file.path === path);
    if (existing?.bytes && !existing.text) throw new Error('Cannot overwrite a binary workspace asset');
    const record = {...existing, path, text};
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
    return record;
  };
  return {
    saveDocument,
    async createDesignDocument(value = createDesign(), requestedPath = 'View.sfdesign.json') {
      const design = validateDesign(value);
      let path = normalizePath(requestedPath);
      if (!path.endsWith('.sfdesign.json')) path = path.replace(/\.json$/i, '') + '.sfdesign.json';
      const existing = new Set(records().map(file => file.path));
      const stem = path.slice(0, -'.sfdesign.json'.length);
      let serial = 1;
      while (existing.has(path)) path = stem + serial++ + '.sfdesign.json';
      await saveDocument(path, JSON.stringify(design, null, 2));
      await context.open(path);
      return context.documents().get(path);
    },
    async createWorkspace(records) {
      if (!globalThis.confirm('Build this design in a new C# workspace? The current workspace will remain in local recovery.')) {
        throw new Error('Build design cancelled');
      }
      saveLocal();
      await context.loadWorkspace(records, {entry: 'DesignerApp.slnx', name: 'DesignerApp'});
    }
  };
}
