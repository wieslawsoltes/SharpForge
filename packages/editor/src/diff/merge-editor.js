import {merge3} from '@sharpforge/text';
import {node, button, WidgetLifetime} from '../widgets/dom.js';

/** Tracks conflict spans over an editable merge result; unresolved bytes are retained until explicitly resolved. */
export class MergeSession {
  constructor(base, ours, theirs, options = {}) {
    this.result = merge3(base, ours, theirs, options);
    this.text = this.result.text;
    this.conflicts = this.result.conflicts.map((conflict, index) => ({...conflict, id: conflict.id ?? index, resolved: false}));
    this.history = [];
    this.future = [];
  }

  get unresolved() { return this.conflicts.filter(conflict => !conflict.resolved).length; }

  snapshot() {
    return {text: this.text, conflicts: this.conflicts.map(conflict => ({...conflict}))};
  }

  record() {
    this.history.push(this.snapshot());
    if (this.history.length > 100) this.history.shift();
    this.future = [];
  }

  resolve(id, choice) {
    const conflict = this.conflicts.find(item => item.id === id);
    if (!conflict || conflict.resolved) throw new RangeError('Conflict is unavailable or already resolved');
    const replacements = {left: conflict.ours, right: conflict.theirs, both: conflict.ours + conflict.theirs,
      base: conflict.base, manual: this.text.slice(conflict.start, conflict.end)};
    if (!Object.hasOwn(replacements, choice)) throw new RangeError('Unknown merge resolution');
    this.record();
    this.replace(conflict.start, conflict.end, replacements[choice]);
    conflict.resolved = true;
    conflict.resolution = choice;
    return this.text;
  }

  edit(start, end, text) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > this.text.length || typeof text !== 'string') {
      throw new RangeError('Invalid merge result edit');
    }
    this.record();
    this.replace(start, end, text);
  }

  replace(start, end, text) {
    const delta = text.length - end + start;
    this.text = this.text.slice(0, start) + text + this.text.slice(end);
    for (const conflict of this.conflicts) {
      if (conflict.start >= end && conflict.start > start) {
        conflict.start += delta;
        conflict.end += delta;
      } else if (conflict.end > start && conflict.start < end || start === end && start >= conflict.start && start <= conflict.end) {
        conflict.start = Math.min(conflict.start, start);
        conflict.end = Math.max(start + text.length, conflict.end + delta);
      }
    }
  }

  undo(redo = false) {
    const source = redo ? this.future : this.history;
    const target = redo ? this.history : this.future;
    if (!source.length) return false;
    target.push(this.snapshot());
    const previous = source.pop();
    this.text = previous.text;
    this.conflicts = previous.conflicts;
    return true;
  }
}

export class MergeEditor {
  constructor(element, options) {
    this.element = element;
    this.options = options;
    this.document = element.ownerDocument;
    this.lifetime = new WidgetLifetime();
    this.session = new MergeSession(options.base, options.ours, options.theirs, options);
    element.classList.add('sf-merge-editor');
    const inputs = node(this.document, 'div', {className: 'sf-merge-inputs'});
    inputs.append(this.sourcePane('Left', options.ours), this.sourcePane('Right', options.theirs));
    this.controls = node(this.document, 'div', {className: 'sf-merge-conflicts'});
    this.status = node(this.document, 'span', {role: 'status', 'aria-live': 'polite'});
    this.result = node(this.document, 'textarea', {'aria-label': 'Merge result', spellcheck: false, className: 'sf-merge-result'});
    this.result.value = this.session.text;
    const toolbar = node(this.document, 'div', {className: 'sf-diff-toolbar'});
    toolbar.append(this.status, button(this.document, 'Undo resolution', () => {
      if (this.session.undo()) this.publish();
    }));
    element.append(inputs, toolbar, this.controls, this.result);
    this.lifetime.listen(this.result, 'input', () => this.edited());
    this.lifetime.listen(this.result, 'keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (this.session.undo(event.shiftKey)) this.publish();
    });
    this.render();
  }

  sourcePane(label, text) {
    const pane = node(this.document, 'section', {className: 'sf-merge-source'});
    pane.append(node(this.document, 'header', {}, label), node(this.document, 'pre', {}, text));
    return pane;
  }

  edited() {
    const previous = this.session.text;
    const text = this.result.value;
    let start = 0;
    while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
    let end = previous.length;
    let newEnd = text.length;
    while (end > start && newEnd > start && previous[end - 1] === text[newEnd - 1]) { end--; newEnd--; }
    this.session.edit(start, end, text.slice(start, newEnd));
    this.render();
    this.options.onChange?.(this.session.text, this.session.unresolved);
  }

  render() {
    this.status.textContent = `${this.session.unresolved} unresolved conflicts`;
    this.controls.replaceChildren();
    for (const [index, conflict] of this.session.conflicts.entries()) {
      if (conflict.resolved) continue;
      const group = node(this.document, 'div', {className: 'sf-merge-conflict', role: 'group', 'aria-label': `Conflict ${index + 1}`});
      group.append(button(this.document, `Conflict ${index + 1}`, () => {
        this.result.focus();
        this.result.setSelectionRange(conflict.start, conflict.end);
      }));
      for (const [choice, label] of [['left', 'Take left'], ['right', 'Take right'], ['both', 'Take both'], ['manual', 'Mark manual edit resolved']]) {
        group.append(button(this.document, label, () => {
          this.session.resolve(conflict.id, choice);
          this.publish();
        }));
      }
      const base = node(this.document, 'details');
      base.append(node(this.document, 'summary', {}, 'Base'), node(this.document, 'pre', {}, conflict.base));
      group.append(base);
      this.controls.append(group);
    }
  }

  publish() {
    this.result.value = this.session.text;
    this.render();
    this.options.onChange?.(this.session.text, this.session.unresolved);
  }

  get value() { return this.session.text; }
  get unresolved() { return this.session.unresolved; }
  dispose() { this.lifetime.dispose(); this.element.replaceChildren(); }
}

export function createMergeEditor(element, options) { return new MergeEditor(element, options); }
