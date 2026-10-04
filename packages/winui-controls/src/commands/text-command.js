import { ControlError } from '../policy/events.js';
import { DataPackage } from '../app/data-transfer.js';

export const textCommandLabels = Object.freeze({ Cut: 'Cut', Copy: 'Copy', Paste: 'Paste', Undo: 'Undo', Redo: 'Redo',
  SelectAll: 'Select all', Delete: 'Delete' });

export function textSelection(model) {
  return { start: model.selectionStart ?? model.selection?.start ?? 0,
    length: model.selectionLength ?? model.selection?.length ?? 0 };
}

/** Selection and history come from the editor model; permission results remain explicit. */
export class TextCommandController {
  constructor({ model, clipboard, readOnly = () => false, beforeEdit = async () => true,
    beforePaste = async () => true, onChanged = () => {} }) {
    this.model = model; this.clipboard = clipboard; this.readOnly = readOnly;
    this.beforeEdit = beforeEdit; this.onChanged = onChanged; this.pending = false;
    this.beforePaste = beforePaste;
    this.controller = new AbortController();
  }

  enabled(name) {
    if (this.pending || this.controller.signal.aborted) return false;
    const selected = textSelection(this.model).length > 0, editable = !this.readOnly(), clipboard = this.clipboard?.available !== false;
    if (name === 'Copy') return selected && clipboard && !!this.clipboard?.setContent;
    if (name === 'Cut') return selected && editable && clipboard && !!this.clipboard?.setContent;
    if (name === 'Paste') return editable && clipboard && !!this.clipboard?.getContent;
    if (name === 'Delete') return selected && editable;
    if (name === 'SelectAll') return this.model.text.length > 0;
    if (name === 'Undo') return editable && !!this.model.canUndo;
    if (name === 'Redo') return editable && !!this.model.canRedo;
    return false;
  }

  async execute(name) {
    if (!Object.hasOwn(textCommandLabels, name)) throw new ControlError('SFUI1655', 'Unknown text command', { name });
    if (!this.enabled(name)) return { ok: false, reason: 'command-disabled' };
    const model = this.model, selection = textSelection(model), before = model.text, signal = this.controller.signal;
    this.pending = true;
    try {
      if (name === 'SelectAll') { model.select(0, model.text.length); return { ok: true }; }
      if (name === 'Copy' || name === 'Cut') {
        const data = new DataPackage(); data.setText(before.slice(selection.start, selection.start + selection.length));
        const result = await this.clipboard.setContent(data, { signal });
        signal.throwIfAborted();
        if (!result.ok || name === 'Copy') return result;
      }
      let text = '';
      if (name === 'Paste') {
        if (!await this.beforePaste({ signal })) return { ok: false, reason: 'cancelled' };
        signal.throwIfAborted();
        const result = await this.clipboard.getContent({ signal });
        signal.throwIfAborted();
        if (!result.ok) return result;
        if (!result.data.contains('Text')) return { ok: false, reason: 'text-format-unavailable' };
        text = result.data.get('Text');
      }
      if (before !== model.text || selection.start !== textSelection(model).start || selection.length !== textSelection(model).length) {
        return { ok: false, reason: 'selection-changed' };
      }
      const history = name === 'Undo' ? model.undoStack?.at(-1) : name === 'Redo' ? model.redoStack?.at(-1) : null;
      const next = history?.text ?? before.slice(0, selection.start) + text + before.slice(selection.start + selection.length);
      const normalized = model.normalize ? model.normalize(next) : next;
      if (!await this.beforeEdit(normalized, { signal })) return { ok: false, reason: 'cancelled' };
      signal.throwIfAborted();
      if (model.text !== before || this.readOnly()) return { ok: false, reason: 'editor-changed' };
      if (name === 'Undo') model.undo({ approved: true });
      else if (name === 'Redo') model.redo({ approved: true });
      else if (typeof model.insert === 'function') model.insert(text, { reason: name === 'Paste' ? 'paste' : 'cut', approved: true });
      else model.replaceSelection(text);
      return { ok: true };
    } finally { this.pending = false; this.onChanged(); }
  }

  dispose() { this.controller.abort(new DOMException('Text flyout disposed', 'AbortError')); }
}
