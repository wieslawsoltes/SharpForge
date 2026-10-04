import { ControlEvents, ControlError, requireInteger } from '../policy/events.js';
import { truncateUtf16 } from './utf16.js';

/** UTF-16 selection offsets match .NET and DOM selection APIs. IME edits commit atomically. */
export class TextBuffer extends ControlEvents {
  constructor({ text = '', maximumLength = 0, historyLimit = 100, characterCasing = 0, readOnly = false, now = () => Date.now() } = {}) {
    super();
    this.maximumLength = requireInteger(maximumLength, 'Maximum text length', { maximum: 16 * 1024 * 1024 });
    this.historyLimit = requireInteger(historyLimit, 'History limit', { maximum: 1000 });
    this.characterCasing = characterCasing;
    this.readOnly = readOnly;
    this.text = maximumLength ? truncateUtf16(String(text), maximumLength) : String(text);
    if (this.text.length > 16 * 1024 * 1024) throw new ControlError('SFUI1620', 'Text length exceeds the control limit');
    this.selectionStart = 0;
    this.selectionLength = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.composition = null;
    this.now = now;
    this.editGroup = null;
  }

  get selectedText() { return this.text.slice(this.selectionStart, this.selectionStart + this.selectionLength); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  select(start, length = 0) {
    requireInteger(start, 'Selection start', { maximum: this.text.length });
    requireInteger(length, 'Selection length', { maximum: this.text.length - start });
    if (this.selectionStart === start && this.selectionLength === length) return;
    this.selectionStart = start;
    this.selectionLength = length;
    this.editGroup = null;
    this.emit('SelectionChanged', { SelectionStart: start, SelectionLength: length });
  }

  selectAll() { this.select(0, this.text.length); }

  replace(text, { reason = 'programmatic', selectionStart, selectionLength = 0, record = true, force = false, approved = false } = {}) {
    if (this.readOnly && !force) return false;
    const value = this.normalize(text);
    if (!approved) {
      const args = this.emit('BeforeTextChanging', { NewText: value, Cancel: false, reason });
      if (args.Cancel) return false;
    }
    const previous = this.#capture();
    const changed = value !== this.text;
    if (record && changed) {
      const inserted = value.length - previous.text.length;
      const typing = reason === 'user' && previous.selectionLength === 0 && inserted > 0 && inserted <= 8
        && value.slice(0, previous.selectionStart) === previous.text.slice(0, previous.selectionStart)
        && value.slice(previous.selectionStart + inserted) === previous.text.slice(previous.selectionStart);
      const timestamp = this.now();
      const grouped = typing && this.editGroup?.end === previous.selectionStart
        && timestamp >= this.editGroup.at && timestamp - this.editGroup.at <= 1000;
      if (!grouped) this.undoStack.push(previous);
      if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
      this.redoStack.length = 0;
      this.editGroup = typing ? { at: timestamp, end: previous.selectionStart + inserted } : null;
    }
    this.text = value;
    this.selectionStart = Math.max(0, Math.min(value.length, selectionStart ?? this.selectionStart));
    this.selectionLength = Math.max(0, Math.min(value.length - this.selectionStart, selectionLength));
    if (changed) {
      this.emit('TextChanging', { IsContentChanging: true, reason });
      this.emit('TextChanged', { OldText: previous.text, Text: value, reason,
        Reason: reason === 'suggestion' ? 2 : ['user', 'paste', 'cut', 'composition'].includes(reason) ? 0 : 1 });
    }
    if (previous.selectionStart !== this.selectionStart || previous.selectionLength !== this.selectionLength) {
      this.emit('SelectionChanged', { SelectionStart: this.selectionStart, SelectionLength: this.selectionLength });
    }
    return true;
  }

  normalize(text) {
    let value = String(text);
    if (this.characterCasing === 1) value = value.toLowerCase();
    if (this.characterCasing === 2) value = value.toUpperCase();
    if (this.maximumLength > 0) value = truncateUtf16(value, this.maximumLength);
    if (value.length > 16 * 1024 * 1024) throw new ControlError('SFUI1620', 'Text length exceeds the control limit');
    return value;
  }

  insert(text, options = {}) {
    const value = String(text);
    return this.replace(this.text.slice(0, this.selectionStart) + value + this.text.slice(this.selectionStart + this.selectionLength),
      { ...options, selectionStart: this.selectionStart + value.length, selectionLength: 0 });
  }

  beginComposition() {
    if (this.composition || this.readOnly) return false;
    this.composition = { before: this.#capture(), text: '' };
    this.editGroup = null;
    this.emit('TextCompositionStarted', { Text: '' });
    return true;
  }

  updateComposition(text) {
    if (!this.composition && !this.beginComposition()) return false;
    this.composition.text = String(text);
    this.emit('TextCompositionChanged', { Text: this.composition.text });
  }

  endComposition(text, { cancelled = false, fullText = false, selectionStart, approved = false } = {}) {
    if (!this.composition) return;
    const composition = this.composition;
    this.composition = null;
    if (!cancelled) {
      this.selectionStart = composition.before.selectionStart;
      this.selectionLength = composition.before.selectionLength;
      if (fullText) this.replace(text, { reason: 'composition', selectionStart, approved });
      else this.insert(text, { reason: 'composition', approved });
    }
    this.emit('TextCompositionEnded', { Text: cancelled ? '' : String(text), Cancelled: cancelled, FullText: fullText,
      SelectionStart: this.selectionStart, SelectionLength: this.selectionLength });
  }

  undo(options) { return this.#restore(this.undoStack, this.redoStack, 'undo', options); }
  redo(options) { return this.#restore(this.redoStack, this.undoStack, 'redo', options); }
  clearUndoRedoHistory() { this.undoStack.length = this.redoStack.length = 0; this.editGroup = null; }
  #capture() { return { text: this.text, selectionStart: this.selectionStart, selectionLength: this.selectionLength }; }
  snapshot() {
    return { version: 1, ...this.#capture(), maximumLength: this.maximumLength, historyLimit: this.historyLimit,
      characterCasing: this.characterCasing, readOnly: this.readOnly,
      undo: this.undoStack.map(item => ({ ...item })), redo: this.redoStack.map(item => ({ ...item })),
      composition: this.composition ? { before: { ...this.composition.before }, text: this.composition.text } : null,
      editGroup: this.editGroup ? { ...this.editGroup } : null };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || typeof snapshot.text !== 'string' || !Array.isArray(snapshot.undo) || !Array.isArray(snapshot.redo)) {
      throw new ControlError('SFUI1620', 'Invalid text-buffer snapshot');
    }
    this.text = snapshot.text;
    this.selectionStart = snapshot.selectionStart;
    this.selectionLength = snapshot.selectionLength;
    this.maximumLength = snapshot.maximumLength;
    this.historyLimit = snapshot.historyLimit;
    this.characterCasing = snapshot.characterCasing;
    this.readOnly = snapshot.readOnly;
    this.undoStack = snapshot.undo.map(item => ({ ...item }));
    this.redoStack = snapshot.redo.map(item => ({ ...item }));
    this.composition = snapshot.composition ? { before: { ...snapshot.composition.before }, text: snapshot.composition.text } : null;
    this.editGroup = snapshot.editGroup ? { ...snapshot.editGroup } : null;
  }

  #restore(source, destination, reason, options = {}) {
    if (this.readOnly || !source.length || this.composition) return false;
    const previous = this.#capture();
    const next = source.at(-1);
    if (!this.replace(next.text, { reason, record: false, ...next, ...options })) return false;
    source.pop();
    destination.push(previous);
    this.editGroup = null;
    return true;
  }
}
