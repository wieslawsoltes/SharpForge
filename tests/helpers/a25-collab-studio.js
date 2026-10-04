import { createDocumentEvents } from '../../apps/studio/services/documents.js';
import { applyStudioTextEdits } from '../../apps/studio/services/edits.js';

export function editorFixture() {
  const value = { identity: 'preview:same-name:1', classic: false };
  const events = createDocumentEvents();
  const state = { name: 'same-name', active: 'Program.cs', files: [
    { uri: 'Program.cs', text: 'abcd', version: 1 }, { uri: 'Other.cs', text: 'other', version: 1 }
  ], breakpoints: {}, dirtyFiles: new Set(), revision: 0, diskRevision: 0 };
  const input = new EventTarget();
  Object.assign(input, { value: 'abcd', selectionStart: 0, selectionEnd: 0, selectionDirection: 'forward',
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } });
  const originalChange = text => {
    if (state.applyingEdits) return;
    state.files[0].text = text;
    events.publish('Program.cs', text);
  };
  const originalCursor = () => undefined;
  const editor = { uri: 'Program.cs', input, element: { classList: { contains: () => value.classic } },
    onChange: originalChange, onCursor: originalCursor, get value() { return input.value; },
    setValue(text) { input.value = text; this.onChange(text); } };
  const editors = new Map([['Program.cs', editor]]);
  const editHost = { state, editors, documentEvents: events, remapSourceBreakpoints: () => [],
    renderWorkspace() {}, saveLocal() {}, analyze() {} };
  const workbench = { preferences: { model: { values: { userName: 'Name' } } }, safe: action => Promise.resolve().then(action),
    host: { getState: () => state, getEditors: () => editors, getWorkspaceIdentity: () => value.identity,
      services: { get: () => events }, toast() {}, showPanel() {}, applyEdits: edits => applyStudioTextEdits(editHost, edits) } };
  const cursors = { disposed: 0, set() {}, redraw() {}, dispose() { this.disposed++; } };
  return Object.assign(value, { events, state, editor, workbench, cursors, originalChange, originalCursor });
}

