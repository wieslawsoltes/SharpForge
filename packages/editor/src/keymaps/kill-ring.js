import { adjacentWord } from '../commands/movement.js';

/** Emacs mark and kill ring state belongs to one editor and survives profile switches. */
export class EmacsState {
  constructor(context, { limit = 64, maxCharacters = 4 * 1024 * 1024 } = {}) {
    this.context = context;
    this.limit = limit;
    this.maxCharacters = maxCharacters;
    this.ring = [];
    this.mark = null;
    this.markActive = false;
    this.last = null;
    this.yank = null;
    this.ringIndex = 0;
  }
  push(text, append = false, prepend = false) {
    if (text.length + (append ? this.ring[0]?.length ?? 0 : 0) > this.maxCharacters) {
      throw new RangeError('Killed text exceeds the clipboard budget');
    }
    if (append && this.ring.length) this.ring[0] = prepend ? text + this.ring[0] : this.ring[0] + text;
    else this.ring.unshift(text);
    let total = 0;
    this.ring = this.ring.filter((value, index) => {
      total += value.length;
      return index < this.limit && total <= this.maxCharacters;
    });
    this.ringIndex = 0;
  }
  kill(start, end, { copy = false, prepend = false } = {}) {
    if (!copy && this.context.readOnly) return false;
    const text = this.context.slice(start, end);
    this.push(text, this.last === 'kill', prepend);
    if (!copy) this.context.apply([{ start, deleteCount: end - start, text: '' }], [{ anchor: start, head: start }]);
    this.markActive = false;
    this.last = 'kill';
    return text;
  }
  execute(command) {
    const context = this.context;
    const point = context.selection.head;
    const position = context.position(point);
    switch (command) {
      case 'Emacs.SetMark':
        this.mark = point;
        this.markActive = !this.markActive;
        context.status(this.markActive ? 'Mark set' : 'Mark deactivated');
        return true;
      case 'Emacs.ExchangePointAndMark': {
        if (this.mark === null) throw new Error('The mark is not set');
        const previous = this.mark;
        this.mark = point;
        this.markActive = true;
        context.select([{ anchor: point, head: previous }]);
        return true;
      }
      case 'Emacs.Cancel':
        this.markActive = false;
        context.goto(point);
        context.status('Quit');
        return true;
      case 'Emacs.KillLine': {
        let end = context.lineEnd(position.line);
        if (end === point) end = context.lineEnd(position.line, true);
        return this.kill(point, end);
      }
      case 'Emacs.KillWord': return this.kill(point, adjacentWord(context, point, 1));
      case 'Emacs.BackwardKillWord': return this.kill(adjacentWord(context, point, -1), point, { prepend: true });
      case 'Emacs.CopyRegion':
      case 'Emacs.KillRegion': {
        if (this.mark === null) throw new Error('The mark is not set');
        return this.kill(Math.min(point, this.mark), Math.max(point, this.mark), { copy: command === 'Emacs.CopyRegion' });
      }
      case 'Emacs.Yank':
        if (context.readOnly) return false;
        if (!this.ring.length) throw new Error('The kill ring is empty');
        this.ringIndex = 0;
        this.yank = { start: Math.min(context.selection.anchor, point), text: this.ring[0] };
        context.insert(this.yank.text);
        this.yank.version = context.buffer?.version;
        this.last = 'yank';
        return true;
      case 'Emacs.YankPop': {
        if (context.readOnly) return false;
        if (this.last !== 'yank' || !this.yank || this.yank.version !== context.buffer?.version) {
          throw new Error('Yank-pop must immediately follow a yank');
        }
        this.ringIndex = (this.ringIndex + 1) % this.ring.length;
        const text = this.ring[this.ringIndex];
        const head = this.yank.start + text.length;
        context.apply([{ start: this.yank.start, deleteCount: this.yank.text.length, text }], [{ anchor: head, head }]);
        this.yank.text = text;
        this.yank.version = context.buffer?.version;
        return true;
      }
      default: return false;
    }
  }
  afterCommand(command) {
    if (!/^Emacs\.(KillLine|KillWord|BackwardKillWord|KillRegion|CopyRegion|Yank|YankPop)$/.test(command)) this.last = null;
  }
}
