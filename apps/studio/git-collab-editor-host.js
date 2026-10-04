import { GitError } from '@sharpforge/git';
import { createGitEditorCursors } from './git-editor-cursors.js';
import { subscribeGitEditorView } from './git-editor-geometry.js';

/** Return one UTF-16 replacement, the unit used by both SourceText and the sequence CRDT. */
export function sourceReplacement(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') throw new TypeError('Source replacements require strings');
  let start = 0;
  const maximum = Math.min(before.length, after.length);
  while (start < maximum && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { start, deleteCount: oldEnd - start, insertText: after.slice(start, newEnd) };
}

/** Bind one exact Studio workspace/document through the shared document service, retaining existing editor callbacks. */
export function createStudioEditorCollaborationHost(workbench, editor, element, { createCursors = createGitEditorCursors } = {}) {
  if (!editor?.input || editor.disposed || editor.element.classList.contains('sf-classic-active')) {
    throw new GitError('Unsupported', 'Live collaboration requires an open standard source editor; classic editor modes are not supported');
  }
  const uri = editor.uri;
  const workspaceIdentity = workbench.host.getWorkspaceIdentity();
  const invalidations = new Set();
  const subscriptions = new Set();
  let disposed = false;
  let invalidated = null;
  let observedText;

  function currentFile() {
    if (disposed) throw new GitError('Disposed', 'The collaboration editor binding is disposed');
    if (invalidated) throw invalidated;
    if (workspaceIdentity !== workbench.host.getWorkspaceIdentity()) throw new GitError('Conflict', 'The collaboration workspace changed');
    if (editor.uri !== uri) throw new GitError('Conflict', 'The collaboration editor now displays another document');
    if (editor.disposed || editor.element.classList.contains('sf-classic-active')) {
      throw new GitError('Unsupported', 'The collaboration editor was closed or switched to an unsupported classic mode');
    }
    const state = workbench.host.getState();
    if (state.readOnly || editor.input.readOnly) {
      throw new GitError('Conflict', 'Live collaboration cannot change a document while the debugger makes it read-only');
    }
    const file = state.files.find(item => item.uri === uri);
    if (!file) throw new GitError('NotFound', 'The collaboration document was removed');
    return file;
  }

  function invalidate(error) {
    if (disposed || invalidated) return;
    invalidated = error;
    cursors.set([]);
    for (const listener of invalidations) listener(error);
  }

  function track(unsubscribe) {
    subscriptions.add(unsubscribe);
    return () => { subscriptions.delete(unsubscribe); unsubscribe(); };
  }

  function selection() {
    currentFile();
    if (editor.uri !== uri) return null;
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = editor.input;
    return direction === 'backward' ? { anchor: end, focus: start } : { anchor: start, focus: end };
  }

  observedText = currentFile().text;
  const cursors = createCursors(editor);

  return {
    element, documentId: uri, workspaceIdentity, getText: () => currentFile().text, getSelection: selection, invalidate,
    isCurrent() { try { currentFile(); return true; } catch { return false; } },
    onInvalidated(listener) {
      currentFile();
      invalidations.add(listener);
      return () => invalidations.delete(listener);
    },
    onTextChange(listener) {
      let before = currentFile().text;
      observedText = before;
      return track(workbench.host.services.get('documents').subscribe(event => {
        if (event.type === 'reset') {
          invalidate(new GitError('Conflict', 'The workspace documents were replaced; rejoin live collaboration for the current document'));
          return;
        }
        try { currentFile(); } catch (error) { invalidate(error); return; }
        if (event.uri !== uri) return;
        const change = sourceReplacement(before, event.text);
        before = event.text;
        observedText = event.text;
        if (change.deleteCount || change.insertText) listener(change);
        cursors.redraw();
      }));
    },
    onSelectionChange(listener) {
      currentFile();
      const update = () => {
        try { currentFile(); } catch (error) { invalidate(error); return; }
        const value = selection();
        if (value) listener(value);
      };
      const unsubscribeView = subscribeGitEditorView(editor, { cursor: update });
      if (unsubscribeView) return track(unsubscribeView);
      const events = ['select', 'click', 'keyup'];
      for (const type of events) editor.input.addEventListener(type, update);
      return track(() => { for (const type of events) editor.input.removeEventListener(type, update); });
    },
    applyRemoteTextChange(change) {
      const file = currentFile();
      if (file.text !== observedText) {
        throw new GitError('Conflict', 'The collaboration source changed outside the document notification service');
      }
      if (!Number.isInteger(change.start) || !Number.isInteger(change.deleteCount) || change.start < 0
        || change.deleteCount < 0 || change.start + change.deleteCount > file.text.length || typeof change.insertText !== 'string') {
        throw new GitError('Corrupt', 'Remote collaboration edit is outside its source document');
      }
      workbench.host.applyEdits([{ uri, start: change.start, end: change.start + change.deleteCount, newText: change.insertText }]);
      observedText = currentFile().text;
    },
    setSelection(value) {
      currentFile();
      if (editor.uri === uri) editor.input.setSelectionRange(Math.min(value.anchor, value.focus), Math.max(value.anchor, value.focus),
        value.focus < value.anchor ? 'backward' : 'forward');
    },
    setRemoteCursors(peers) {
      try { currentFile(); } catch (error) { invalidate(error); return; }
      cursors.set(editor.uri === uri ? peers : []);
    },
    announce: message => workbench.host.toast(message),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
      invalidations.clear();
      cursors.dispose();
    }
  };
}
