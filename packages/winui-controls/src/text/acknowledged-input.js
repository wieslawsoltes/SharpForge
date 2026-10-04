import { ControlError, stateFor } from '../policy/events.js';
import { controlEventRequester, requestControlEvent } from '../policy/event-requests.js';

function previousCharacter(text, index) {
  if (!index) return 0;
  const value = text.charCodeAt(index - 1);
  return index > 1 && value >= 0xdc00 && value <= 0xdfff ? index - 2 : index - 1;
}

function nextCharacter(text, index) {
  const value = text.charCodeAt(index);
  return Math.min(text.length, index + (value >= 0xd800 && value <= 0xdbff ? 2 : 1));
}

/** Edit intent is rebased on the preceding accepted caret, so a cancelled keystroke is never replayed. */
export function proposedTextEdit(model, operation) {
  if (operation.type === 'composition' || operation.type === 'replacement') {
    return { text: model.normalize(operation.text), selectionStart: operation.selection?.start ?? operation.text.length };
  }
  if (operation.type === 'historyUndo' || operation.type === 'historyRedo') {
    const snapshot = (operation.type === 'historyUndo' ? model.undoStack : model.redoStack).at(-1);
    return snapshot ? { ...snapshot } : null;
  }
  const text = model.text;
  let start = operation.selection?.start ?? model.selectionStart;
  let end = operation.selection?.end ?? model.selectionStart + model.selectionLength;
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  if (operation.type.startsWith('delete') && start === end) {
    if (operation.type.endsWith('Backward')) start = previousCharacter(text, start);
    else if (operation.type.endsWith('Forward')) end = nextCharacter(text, end);
    if (operation.type === 'deleteWordBackward') while (start > 0 && /\S/u.test(text[start - 1])) start--;
    if (operation.type === 'deleteWordForward') while (end < text.length && /\S/u.test(text[end])) end++;
    if (operation.type === 'deleteSoftLineBackward') start = text.lastIndexOf('\n', start - 1) + 1;
    if (operation.type === 'deleteSoftLineForward') { const next = text.indexOf('\n', end); end = next < 0 ? text.length : next; }
  }
  const inserted = operation.type.startsWith('delete') ? '' : operation.text ?? '';
  return { text: model.normalize(text.slice(0, start) + inserted + text.slice(end)), selectionStart: start + inserted.length, selectionLength: 0 };
}

function inputState(context, node) {
  return stateFor(context, node, 'acknowledged-edit', () => ({ queue: [], busy: false, paste: '', disposed: false, controller: null,
    dispose() { this.disposed = true; this.queue.length = 0; this.controller?.abort(); } }));
}

function synchronizeEditor(editor, model) {
  editor.value = model.text;
  editor.setSelectionRange?.(model.selectionStart, model.selectionStart + model.selectionLength);
}

async function processEdits(context, node, editor, model, state) {
  if (state.busy) return;
  state.busy = true;
  try {
    while (state.queue.length && !state.disposed) {
      const operation = state.queue.shift();
      state.controller = new AbortController();
      if (operation.pasteEvent) {
        const paste = await requestControlEvent(context, node, 'Paste',
          { Handled: false, Cancel: false }, { signal: state.controller.signal });
        if (state.disposed) return;
        if (paste.Handled || paste.Cancel) {
          state.controller = null;
          synchronizeEditor(editor, model);
          continue;
        }
      }
      const proposal = proposedTextEdit(model, operation);
      if (!proposal) { state.controller = null; continue; }
      const before = model.text;
      const payload = node.events?.includes('BeforeTextChanging')
        ? await requestControlEvent(context, node, 'BeforeTextChanging',
          { NewText: proposal.text, Cancel: false, reason: 'user' }, { signal: state.controller.signal }) : { Cancel: false };
      state.controller = null;
      if (state.disposed) return;
      if (model.text !== before) {
        throw new ControlError('SFUI1624', 'Text changed while a BeforeTextChanging request was pending');
      }
      if (operation.type === 'composition') {
        model.endComposition(proposal.text, { cancelled: !!payload.Cancel, fullText: true,
          selectionStart: proposal.selectionStart, approved: true });
      } else if (!payload.Cancel) {
        if (operation.type === 'historyUndo') model.undo({ approved: true });
        else if (operation.type === 'historyRedo') model.redo({ approved: true });
        else model.replace(proposal.text, { reason: 'user', selectionStart: proposal.selectionStart,
          selectionLength: proposal.selectionLength ?? 0, approved: true });
      }
      synchronizeEditor(editor, model);
      context.invalidate(node.id);
    }
  } catch (error) {
    state.queue.length = 0;
    if (!state.disposed) {
      if (model.composition) model.endComposition('', { cancelled: true });
      synchronizeEditor(editor, model);
      context.host.options.onError?.(error);
    }
  } finally { state.busy = false; state.controller = null; }
}

function enqueue(context, node, editor, model, operation) {
  const state = inputState(context, node);
  if (state.queue.length >= 128) throw new ControlError('SFUI1624', 'Pending text edits exceed the 128-operation budget');
  if (!state.busy && !state.queue.length || operation.type === 'composition') {
    operation.selection = { start: editor.selectionStart ?? model.selectionStart, end: editor.selectionEnd ?? model.selectionStart };
  }
  state.queue.push(operation);
  void processEdits(context, node, editor, model, state);
}

const supportedInputs = new Set(['insertText', 'insertReplacementText', 'insertFromPaste', 'insertFromDrop',
  'insertLineBreak', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward',
  'deleteWordForward', 'deleteSoftLineBackward', 'deleteSoftLineForward', 'deleteByCut', 'deleteByDrag',
  'historyUndo', 'historyRedo']);

/** Cancel native edits immediately; accepted text is committed after the application's response. */
export function interceptAcknowledgedEdit(context, node, editor, model, event) {
  const beforeChanging = node.events?.includes('BeforeTextChanging');
  const pasteSubscribed = node.events?.includes('Paste');
  if (!beforeChanging && !pasteSubscribed) return false;
  const state = inputState(context, node);
  if (event.type === 'paste') {
    state.paste = event.clipboardData?.getData('text/plain') ?? '';
    if (pasteSubscribed && event.cancelable) {
      event.preventDefault();
      if (!model.readOnly) enqueue(context, node, editor, model,
        { type: 'insertFromPaste', text: state.paste, pasteEvent: true });
      state.paste = '';
      return true;
    }
    return false;
  }
  if (!controlEventRequester(context) || !beforeChanging && !state.busy) return false;
  if (event.type === 'compositionend') {
    enqueue(context, node, editor, model, { type: 'composition', text: editor.value });
    return true;
  }
  if (event.type === 'beforeinput') {
    if (event.isComposing || model.composition) return false;
    if (!event.cancelable) return false;
    event.preventDefault();
    if (model.readOnly) return true;
    if (!supportedInputs.has(event.inputType)) {
      throw new ControlError('SFUI1624', 'Unsupported acknowledged text input type', { inputType: event.inputType });
    }
    const text = ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ? '\n'
      : event.data ?? event.dataTransfer?.getData('text/plain') ?? (event.inputType === 'insertFromPaste' ? state.paste : '');
    if ((event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') && !node.properties.AcceptsReturn) return true;
    state.paste = '';
    enqueue(context, node, editor, model, { type: event.inputType, text });
    return true;
  }
  if (event.type === 'input' && !event.isComposing && !model.composition && editor.value !== model.text) {
    enqueue(context, node, editor, model, { type: 'replacement', text: editor.value });
    synchronizeEditor(editor, model);
    return true;
  }
  if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    enqueue(context, node, editor, model, { type: event.key.toLowerCase() === 'y' || event.shiftKey ? 'historyRedo' : 'historyUndo' });
    return true;
  }
  return false;
}
