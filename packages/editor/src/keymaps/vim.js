import { findTextMatches } from '@sharpforge/text';
import { adjacentCharacter } from '../commands/movement.js';
import { findCharacter, motionRange, vimMotion, vimWord } from './vim-motions.js';
import { textObject } from './vim-text-objects.js';
import { VimRegisters } from './vim-registers.js';
import { VimExCommands } from './vim-ex.js';
import { openKeymapPrompt } from './prompt.js';
import { applyOperator, enterInsert, joinLines, leaveInsert, pasteRegister, removeCharacters,
  toggleVisual, updateVisual, visualRanges } from './vim-actions.js';

function keyToken(event) {
  if (event.ctrlKey && !event.altKey && !event.metaKey) return `Ctrl+${event.key.toLowerCase()}`;
  if (event.altKey || event.metaKey) return null;
  return event.key === ' ' ? 'Space' : event.key;
}

/** Native Vim modal state machine. Motions/operators, registers, marks and macros mutate one shared EditorModel. */
export class VimKeymap {
  constructor(context, { onState = () => {}, prompt } = {}) {
    this.context = context;
    this.onState = onState;
    this.prompt = prompt;
    this.mode = 'normal';
    this.registers = new VimRegisters(context);
    this.ex = new VimExCommands(context, this);
    this.marks = new Map();
    this.register = '"';
    this.count = '';
    this.operator = null;
    this.pending = null;
    this.keys = [];
    this.lastChange = [];
    this.changed = false;
    this.recording = null;
    this.replayDepth = 0;
    this.replaySteps = 0;
    this.cancelReplay = false;
  }
  get point() { return this.mode.startsWith('visual') ? this.visualHead : this.context.selection.head; }
  notify(message) { this.onState({ keymap: 'vim', mode: message ?? this.mode, pending: this.count, recording: this.recording?.name }); }
  takeCount() {
    const explicit = !!this.count;
    const count = Math.max(1, Number(this.count || '1'));
    this.count = '';
    if (!Number.isSafeInteger(count) || count > 10000) throw new RangeError('Vim count exceeds 10,000');
    return { count, explicit };
  }
  resetPending(clearKeys = true) {
    this.pending = null;
    this.operator = null;
    this.count = '';
    if (clearKeys) this.keys = [];
  }
  finishChange() {
    if (this.changed && !this.replayDepth) this.lastChange = [...this.keys];
    this.changed = false;
    this.keys = [];
  }
  handle(event) {
    if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return false;
    const key = keyToken(event);
    if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(key)) return false;
    if (/^F\d+$/.test(key) || key.startsWith('Ctrl+') &&
      !['Ctrl+[', 'Ctrl+r', 'Ctrl+v', 'Ctrl+d', 'Ctrl+u', 'Ctrl+f', 'Ctrl+b', 'Ctrl+w'].includes(key)) return false;
    const result = this.feed(key);
    if (result?.then) result.catch(error => { this.resetPending(); this.notify(error.message); });
    const consumed = result !== false;
    if (consumed) { event.preventDefault(); event.stopPropagation?.(); }
    return consumed;
  }
  feed(key, replay = false) {
    if (this.recording && !(key === 'q' && this.mode === 'normal' && !this.pending)) this.recording.tokens.push(key);
    if (this.recording?.tokens.length > 10000) throw new RangeError('Vim macro exceeds 10,000 keys');
    this.keys.push(key);
    if (this.keys.length > 10000) this.keys.shift();
    if (this.mode === 'insert' || this.mode === 'replace') return this.insertKey(key, replay);
    if (key === 'Escape' || key === 'Ctrl+[') {
      this.cancelReplay = true;
      if (this.mode.startsWith('visual')) this.context.goto(this.visualHead);
      this.mode = 'normal';
      this.resetPending();
      this.notify();
      return true;
    }
    if (this.pending) return this.completePending(key);
    if (/^\d$/.test(key) && (key !== '0' || this.count)) { this.count += key; this.notify(); return true; }
    if (['d', 'c', 'y', '>', '<'].includes(key)) return this.beginOperator(key);
    if (['i', 'a'].includes(key) && (this.operator || this.mode.startsWith('visual'))) {
      this.pending = { kind: 'object', around: key === 'a' };
      return true;
    }
    const counted = this.takeCount();
    const count = counted.count * (this.operator?.count ?? 1);
    const vertical = ['j', 'k', 'ArrowUp', 'ArrowDown'].includes(key);
    if (!vertical) this.goalColumn = undefined;
    else this.goalColumn ??= this.context.position(this.point).character;
    const motionKey = this.operator?.operation === 'c' && ['w', 'W'].includes(key) &&
      /\S/u.test(this.context.slice(this.point, this.point + 1)) ? (key === 'w' ? 'e' : 'E') : key;
    const motion = vimMotion(this.context, motionKey, this.point, { count, explicitCount: counted.explicit,
      goalColumn: this.goalColumn, lastFind: this.lastFind });
    if (motion) { this.acceptMotion(motion); return true; }
    const handlers = this.commandHandlers(counted.count);
    const handler = handlers[key];
    if (handler) return handler() ?? true;
    this.resetPending();
    this.notify(`Unassigned Vim key: ${key}`);
    return true;
  }
  commandHandlers(count) {
    const context = this.context;
    const point = this.point;
    return {
      i: () => enterInsert(this), a: () => { context.goto(adjacentCharacter(context, point, 1)); enterInsert(this); },
      I: () => { context.goto(context.lineStart(context.position(point).line) + context.line(context.position(point).line).match(/^\s*/u)[0].length); enterInsert(this); },
      A: () => { context.goto(context.lineEnd(context.position(point).line)); enterInsert(this); },
      o: () => this.openLine(false), O: () => this.openLine(true), R: () => enterInsert(this, 'replace'),
      r: () => { this.pending = { kind: 'replace', count }; },
      x: () => removeCharacters(this, false, count), X: () => removeCharacters(this, true, count),
      s: () => {
        let end = point;
        for (let index = 0; index < count; index++) end = adjacentCharacter(context, end, 1);
        applyOperator(this, 'c', [{ start: point, end, linewise: false }]);
      },
      S: () => this.lineOperator('c', count), D: () => this.toEnd('d'), C: () => this.toEnd('c'), Y: () => this.lineOperator('y', count),
      p: () => pasteRegister(this, false, count), P: () => pasteRegister(this, true, count),
      u: () => { for (let index = 0; index < count; index++) context.editor.undo(); this.resetPending(); },
      'Ctrl+r': () => { for (let index = 0; index < count; index++) context.editor.undo(true); this.resetPending(); },
      v: () => toggleVisual(this, 'visual'), V: () => toggleVisual(this, 'visual-line'), 'Ctrl+v': () => toggleVisual(this, 'visual-block'),
      g: () => { this.pending = { kind: 'g', count }; },
      z: () => { this.pending = { kind: 'z' }; },
      f: () => { this.pending = { kind: 'find', direction: 1, till: false, count }; },
      F: () => { this.pending = { kind: 'find', direction: -1, till: false, count }; },
      t: () => { this.pending = { kind: 'find', direction: 1, till: true, count }; },
      T: () => { this.pending = { kind: 'find', direction: -1, till: true, count }; },
      m: () => { this.pending = { kind: 'mark' }; },
      "'": () => { this.pending = { kind: 'jump', linewise: true }; },
      '`': () => { this.pending = { kind: 'jump', linewise: false }; },
      '"': () => { this.pending = { kind: 'register' }; },
      q: () => this.toggleRecording(), '@': () => { this.pending = { kind: 'macro', count }; },
      '.': () => this.replay(this.lastChange, count), J: () => joinLines(this, count),
      '~': () => this.changeCharacterCase(count),
      ':': () => this.openPrompt(':'), '/': () => this.openPrompt('/'), '?': () => this.openPrompt('?'),
      n: () => this.findNext(false, count), N: () => this.findNext(true, count),
      '*': () => this.searchWord(1), '#': () => this.searchWord(-1),
      'Ctrl+d': () => this.scrollPage(1, .5), 'Ctrl+u': () => this.scrollPage(-1, .5),
      'Ctrl+f': () => this.scrollPage(1, 1), 'Ctrl+b': () => this.scrollPage(-1, 1)
    };
  }
  insertKey(key, replay) {
    if (key === 'Escape' || key === 'Ctrl+[') { leaveInsert(this); return true; }
    if (key === 'Ctrl+r') { this.pending = { kind: 'insert-register' }; return true; }
    if (this.pending?.kind === 'insert-register') {
      this.pending = null;
      const version = this.context.buffer.version;
      const uri = this.context.uri;
      return this.registers.read(key).then(value => {
        if (version !== this.context.buffer.version || uri !== this.context.uri) throw new Error('Document changed while reading a register');
        this.context.insert(value.text, { source: 'vim-insert', undoStop: false });
        this.changed = true;
      });
    }
    if (key === 'Ctrl+w') {
      const point = this.context.selection.head;
      const start = vimWord(this.context, point, { direction: -1 });
      this.context.apply([{ start, deleteCount: point - start, text: '' }], [{ anchor: start, head: start }], { undoStop: false });
      this.changed = true;
      return true;
    }
    if (replay || this.mode === 'replace' && (key.length === 1 || key === 'Space')) {
      if (key === 'Backspace') { this.context.editor.deleteText?.(-1); return true; }
      if (key === 'Enter') { this.context.editor.insertNewline?.(); return true; }
      if (key === 'Tab') { this.context.insert('\t', { undoStop: false }); this.changed = true; return true; }
      if (key.length === 1 || key === 'Space') {
        const point = this.context.selection.head;
        const text = key === 'Space' ? ' ' : key;
        const end = this.mode === 'replace' ? Math.min(this.context.lineEnd(this.context.position(point).line),
          adjacentCharacter(this.context, point, 1)) : point;
        this.context.apply([{ start: point, deleteCount: end - point, text }],
          [{ anchor: point + text.length, head: point + text.length }], { source: 'vim-insert', undoStop: false });
        this.changed = true;
        return true;
      }
    }
    if (key.length === 1 || key === 'Space' || ['Backspace', 'Enter', 'Tab', 'Delete'].includes(key)) this.changed = true;
    return false;
  }
  beginOperator(operation) {
    if (this.mode.startsWith('visual')) { applyOperator(this, operation, visualRanges(this)); return true; }
    const { count } = this.takeCount();
    if (this.operator?.operation === operation) return this.lineOperator(operation, count * this.operator.count);
    this.operator = { operation, count, start: this.context.selection.head };
    this.notify(`operator ${operation}`);
    return true;
  }
  lineOperator(operation, count) {
    const line = this.context.position(this.point).line;
    applyOperator(this, operation, [{ start: this.context.lineStart(line),
      end: this.context.lineEnd(Math.min(this.context.lineCount - 1, line + count - 1), true), linewise: true }]);
    return true;
  }
  acceptMotion(motion) {
    if (this.operator) applyOperator(this, this.operator.operation, [motionRange(this.context, this.operator.start, motion)]);
    else if (this.mode.startsWith('visual')) { this.visualHead = motion.target; updateVisual(this); this.keys = []; }
    else { this.context.goto(motion.target); this.resetPending(); }
  }
  completePending(key) {
    const pending = this.pending;
    this.pending = null;
    if (pending.kind === 'register') { this.register = key; return true; }
    if (pending.kind === 'mark') { this.marks.set(key, { uri: this.context.uri, offset: this.point }); this.resetPending(); return true; }
    if (pending.kind === 'record') { this.recording = { name: key, tokens: [] }; this.keys = []; this.notify(); return true; }
    if (pending.kind === 'macro') {
      const name = key === '@' ? this.lastMacro : key;
      const tokens = this.registers.macros.get(name?.toLowerCase());
      if (!tokens) throw new Error(`Macro register ${name ?? ''} is empty`);
      this.lastMacro = name;
      return this.replay(tokens, pending.count);
    }
    if (pending.kind === 'jump') {
      const mark = this.marks.get(key);
      if (!mark) throw new Error(`Mark '${key}' is not set`);
      if (mark.uri !== this.context.uri) return this.context.host('openDocument', { path: mark.uri, offset: mark.offset });
      const target = pending.linewise ? this.context.lineStart(this.context.position(mark.offset).line) : mark.offset;
      this.acceptMotion({ target, linewise: pending.linewise, inclusive: false });
      return true;
    }
    if (pending.kind === 'find') {
      this.lastFind = { character: key, ...pending };
      const motion = findCharacter(this.context, this.point, key, { ...pending, count: pending.count * (this.operator?.count ?? 1) });
      if (motion) this.acceptMotion(motion); else this.resetPending();
      return true;
    }
    if (pending.kind === 'object') {
      const { count } = this.takeCount();
      const range = textObject(this.context, this.point, key, pending.around, count * (this.operator?.count ?? 1));
      if (!range) throw new Error(`Text object '${key}' was not found`);
      if (this.operator) applyOperator(this, this.operator.operation, [range]);
      else { this.visualAnchor = range.start; this.visualHead = Math.max(range.start, range.end - 1); updateVisual(this); }
      return true;
    }
    if (pending.kind === 'g') return this.gCommand(key, pending.count);
    if (pending.kind === 'z') {
      const commands = { a: 'Edit.ToggleOutliningExpansion', c: 'Edit.CollapseCurrentRegion', o: 'Edit.UncollapseCurrentRegion',
        M: 'Edit.CollapseAllRegions', R: 'Edit.UncollapseAllRegions' };
      if (!commands[key]) throw new Error(`Unsupported Vim z command: ${key}`);
      this.context.editor.runCommand(commands[key]);
      return true;
    }
    if (pending.kind === 'replace') {
      const start = this.point;
      let end = start;
      for (let index = 0; index < pending.count; index++) end = adjacentCharacter(this.context, end, 1);
      this.context.apply([{ start, deleteCount: end - start, text: key.repeat(pending.count) }], [{ anchor: start, head: start }]);
      this.changed = true;
      this.finishChange();
      return true;
    }
    return true;
  }
  gCommand(key, count) {
    if (key === 'g') { this.acceptMotion(vimMotion(this.context, 'gg', this.point, { count, explicitCount: count > 1 })); return true; }
    if (['u', 'U', '~'].includes(key)) {
      if (this.mode.startsWith('visual')) applyOperator(this, `g${key}`, visualRanges(this));
      else this.operator = { operation: `g${key}`, count, start: this.point };
      return true;
    }
    if (key === 'J') { joinLines(this, count, true); return true; }
    if (key === 'd') { this.context.host('definition'); return true; }
    if (key === 'v' && this.visualRange) { toggleVisual(this, 'visual'); return true; }
    if (key === 'e' || key === 'E') {
      const target = vimWord(this.context, vimWord(this.context, this.point, { direction: -1 }), { direction: -1 });
      this.acceptMotion({ target, linewise: false, inclusive: true });
      return true;
    }
    throw new Error(`Unsupported Vim g command: ${key}`);
  }
  openLine(above) {
    const context = this.context;
    const line = context.position(this.point).line;
    const start = above ? context.lineStart(line) : context.lineEnd(line);
    const indent = context.line(line).match(/^\s*/u)[0];
    const newline = context.editor.options?.eol ?? '\n';
    const text = above ? indent + newline : newline + indent;
    const head = start + (above ? indent.length : text.length);
    enterInsert(this);
    context.apply([{ start, deleteCount: 0, text }], [{ anchor: head, head }], { undoStop: false });
    this.changed = true;
  }
  toEnd(operation) { applyOperator(this, operation, [{ start: this.point, end: this.context.lineEnd(this.context.position(this.point).line) }]); }
  changeCharacterCase(count) {
    let end = this.point;
    for (let index = 0; index < count; index++) end = adjacentCharacter(this.context, end, 1);
    applyOperator(this, 'g~', [{ start: this.point, end, linewise: false }]);
  }
  toggleRecording() {
    if (this.recording) {
      this.registers.setMacro(this.recording.name, this.recording.tokens);
      this.recording = null;
      this.resetPending();
      this.notify();
    } else this.pending = { kind: 'record' };
  }
  async replay(tokens, count = 1) {
    if (this.replayDepth >= 16) throw new RangeError('Vim macro recursion exceeds 16');
    if (!this.replayDepth) { this.replaySteps = 0; this.cancelReplay = false; }
    this.replayDepth++;
    this.context.editor.model?.beginUndoGroup?.('vim-macro');
    try {
      for (let repeat = 0; repeat < count; repeat++) for (const key of [...tokens]) {
        if (this.cancelReplay || ++this.replaySteps > 10000) throw new RangeError('Vim macro cancelled or key budget exceeded');
        await this.feed(key, true);
      }
    } finally { this.context.editor.model?.endUndoGroup?.(); this.replayDepth--; }
    this.keys = [];
  }
  openPrompt(prefix) {
    const submit = value => prefix === ':' ? this.ex.execute(value) : this.searchPattern(value, prefix === '?' ? -1 : 1);
    if (this.prompt) return Promise.resolve(this.prompt(prefix)).then(value => value == null ? undefined : submit(value));
    this.closePrompt?.();
    this.closePrompt = openKeymapPrompt(this.context.editor, { prefix,
      value: prefix === ':' && this.mode.startsWith('visual') ? "'<,'>" : '', onSubmit: submit });
    return true;
  }
  searchPattern(pattern, direction = 1) { this.search = { pattern, direction, matchCase: !this.context.editor.options?.vimIgnoreCase }; return this.findNext(); }
  searchWord(direction) {
    const range = textObject(this.context, this.point, 'w');
    if (!range) return;
    const pattern = this.context.slice(range.start, range.end).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.searchPattern(`\\b${pattern}\\b`, direction);
  }
  findNext(reverse = false, count = 1) {
    if (!this.search) throw new Error('No previous search pattern');
    const context = this.context;
    const result = findTextMatches([{ uri: context.uri, text: context.slice() }], this.search.pattern,
      { regex: true, matchCase: this.search.matchCase, maxMatches: 10000 });
    if (!result.matches.length) throw new Error(`Pattern not found: ${this.search.pattern}`);
    const direction = this.search.direction * (reverse ? -1 : 1);
    let point = this.point;
    for (let step = 0; step < count; step++) {
      const match = direction > 0 ? result.matches.find(value => value.start > point) ?? result.matches[0]
        : result.matches.findLast(value => value.start < point) ?? result.matches.at(-1);
      point = match.start;
    }
    this.acceptMotion({ target: point, linewise: false, inclusive: false });
  }
  scrollPage(direction, fraction) {
    const count = Math.max(1, Math.floor((this.context.editor.element?.clientHeight ?? 440) /
      (this.context.editor.lineHeight ?? 22) * fraction));
    this.acceptMotion(vimMotion(this.context, direction > 0 ? 'j' : 'k', this.point, { count }));
  }
  dispose() {
    this.closePrompt?.();
    if (this.inUndoGroup) this.context.editor.model?.endUndoGroup?.();
    this.registers.dispose();
    this.marks.clear();
  }
}
