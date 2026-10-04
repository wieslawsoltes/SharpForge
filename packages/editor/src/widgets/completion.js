import {EditorPopup, node, button, appendDocumentation, uniqueDomId} from './dom.js';
import {serviceItems} from '../services/providers.js';

const kindIcons = Object.freeze({method: 'm', class: 'C', type: 'T', property: 'p', field: 'f', variable: 'v', keyword: 'k', snippet: '⋯'});

/** Linear subsequence matching with a preference for prefix, word boundaries and adjacent characters. */
export function fuzzyCompletion(label, query) {
  const positions = [];
  const target = label.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const at = target.indexOf(character, cursor);
    if (at < 0) return null;
    positions.push(at);
    score += at === cursor ? 10 : 1;
    if (at === 0 || /[_.\s]/.test(label[at - 1]) || label[at] !== target[at]) score += 5;
    cursor = at + character.length;
  }
  if (target.startsWith(needle)) score += 30;
  return {score: score - label.length / 1000, positions};
}

export function rankCompletions(items, query, recency = new Map(), filter = null) {
  return items.map((item, index) => {
    if (filter && item.kind !== filter) return null;
    const match = fuzzyCompletion(item.filterText ?? item.label, query);
    return match ? {item, index, ...match, score: match.score + (recency.get(item.label) ?? 0) / 1000} : null;
  }).filter(Boolean).sort((left, right) => right.score - left.score ||
    String(left.item.sortText ?? left.item.label).localeCompare(String(right.item.sortText ?? right.item.label)) || left.index - right.index);
}

export class CompletionWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'completion-list', 'group');
    this.list = node(context.document, 'div', {role: 'listbox', id: uniqueDomId(context.document, 'sf-completion')});
    this.list.setAttribute('aria-label', 'Completions');
    this.filters = node(context.document, 'div', {className: 'sf-completion-filters'});
    this.documentation = node(context.document, 'aside', {className: 'sf-completion-documentation'});
    this.modeButton = button(context.document, 'Completion mode', () => this.toggleSuggestion());
    this.popup.element.append(this.list, this.documentation, this.filters, this.modeButton);
    this.items = [];
    this.ranked = [];
    this.recency = new Map();
    this.sequence = 0;
    this.index = 0;
    this.suggestion = false;
    this.filterLevel = 0;
    this.incomplete = false;
  }

  async open(triggerCharacter) {
    const editor = this.context.editor;
    const offset = editor.offset;
    const result = await this.context.request('completion', {offset, triggerCharacter, triggerKind: triggerCharacter ? 2 : 1});
    if (!result || editor.offset !== offset) return;
    this.items = serviceItems(result.value).slice(0, 2000).map(item => ({...item}));
    for (const snippet of this.context.snippets?.catalog ?? []) {
      this.items.push({label: snippet.prefix, kind: 'snippet', detail: snippet.label,
        insertText: snippet.body, insertTextFormat: 2});
    }
    this.requestRevision = result.revision;
    this.end = offset;
    this.incomplete = Boolean(result.value?.isIncomplete);
    if (!this.items.length) return this.close();
    const prefix = editor.value.slice(0, offset).match(/[\p{L}\p{N}_]+$/u)?.[0] ?? '';
    this.start = offset - prefix.length;
    this.index = 0;
    this.filter = null;
    this.buildFilters();
    this.update();
  }

  buildFilters() {
    this.filters.replaceChildren(button(this.context.document, 'All', () => { this.filter = null; this.update(); }));
    for (const kind of new Set(this.items.map(item => item.kind))) {
      this.filters.append(button(this.context.document, kind ?? 'other', () => { this.filter = kind; this.update(); }));
    }
  }

  update() {
    const editor = this.context.editor;
    if (this.start > editor.offset) return this.close();
    const query = editor.value.slice(this.start, editor.offset);
    if (/[^\p{L}\p{N}_]/u.test(query)) return this.close();
    const previous = this.ranked[this.index]?.item;
    this.ranked = rankCompletions(this.items, query, this.recency, this.filter).slice(0, 200);
    if (this.filterLevel > 0) this.ranked = this.ranked.filter(entry => this.filterLevel === 2 ?
      (entry.item.filterText ?? entry.item.label).startsWith(query) :
      (entry.item.filterText ?? entry.item.label).toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
    const retained = this.ranked.findIndex(entry => entry.item === previous);
    this.index = retained < 0 ? 0 : retained;
    if (!this.ranked.length) return this.close();
    this.render();
    this.popup.show();
    editor.input.setAttribute('aria-controls', this.list.id);
    editor.input.setAttribute('aria-expanded', 'true');
  }

  render() {
    const document = this.context.document;
    const entries = this.ranked.map((entry, index) => {
      const option = node(document, 'button', {type: 'button', role: 'option', id: `${this.list.id}-${index}`,
        'aria-selected': index === this.index, className: index === this.index ? 'selected' : ''});
      option.append(node(document, 'span', {className: 'sf-completion-kind'}, kindIcons[entry.item.kind] ?? '•'));
      const label = node(document, 'span');
      const matches = new Set(entry.positions);
      for (let cursor = 0; cursor < entry.item.label.length; cursor++) {
        label.append(node(document, matches.has(cursor) ? 'mark' : 'span', {}, entry.item.label[cursor]));
      }
      option.append(label, node(document, 'small', {}, entry.item.kind ?? ''));
      option.addEventListener('mousedown', event => {
        event.preventDefault();
        this.index = index;
        this.accept();
      });
      return option;
    });
    this.list.replaceChildren(...entries);
    this.context.editor.input.setAttribute('aria-activedescendant', `${this.list.id}-${this.index}`);
    entries[this.index]?.scrollIntoView?.({block: 'nearest'});
    this.context.safe(() => this.showDocumentation());
  }

  async showDocumentation() {
    const item = this.ranked[this.index]?.item;
    this.documentation.replaceChildren();
    if (!item) return;
    this.documentation.append(node(this.context.document, 'code', {}, item.detail ?? item.label));
    appendDocumentation(this.documentation, item.documentation);
    if (!this.context.services.supports('resolveCompletion')) return;
    const result = await this.context.request('resolveCompletion', {item}, {key: 'completion-documentation'});
    if (!result || this.ranked[this.index]?.item !== item) return;
    Object.assign(item, result.value);
    this.documentation.replaceChildren(node(this.context.document, 'code', {}, item.detail ?? item.label));
    appendDocumentation(this.documentation, item.documentation);
  }

  toggleSuggestion() {
    this.suggestion = !this.suggestion;
    this.modeButton.textContent = this.suggestion ? 'Suggestion mode' : 'Completion mode';
    this.modeButton.setAttribute('aria-pressed', String(this.suggestion));
  }

  changeFilterLevel(direction) {
    this.filterLevel = Math.max(0, Math.min(2, this.filterLevel + direction));
    this.context.status(['Completion filtering: subsequence', 'Completion filtering: prefix',
      'Completion filtering: case-sensitive prefix'][this.filterLevel]);
    if (this.popup.visible) this.update();
  }

  accept(character = '') {
    const item = this.ranked[this.index]?.item;
    if (!item || this.context.editor.input.readOnly) return false;
    const editor = this.context.editor;
    if ((item.textEdit || item.additionalTextEdits?.length) && editor.value !== this.requestRevision.text) {
      this.context.status('Completion edits are refreshing for the current source version.');
      this.context.safe(() => this.open());
      return false;
    }
    const range = item.textEdit?.range;
    const source = editor.sourceSnapshot();
    const start = item.textEdit?.start ?? (range ? source.offsetAt(range.start) : this.start);
    const end = item.textEdit?.end ?? (range ? source.offsetAt(range.end) : editor.offset);
    const text = item.textEdit?.newText ?? item.insertText ?? item.label;
    this.close();
    this.recency.set(item.label, ++this.sequence);
    if (this.recency.size > 256) this.recency.delete(this.recency.keys().next().value);
    if (item.insertTextFormat === 2 || item.kind === 'snippet') {
      this.context.snippets.insert(text, {start, end});
      if (character) editor.insert(character);
    } else {
      const suffix = character && !text.endsWith(character) && editor.value[end] !== character ? character : '';
      const edits = [{start, end, text: text + suffix}, ...(item.additionalTextEdits ?? []).map(edit => ({
        start: edit.start ?? source.offsetAt(edit.range.start), end: edit.end ?? source.offsetAt(edit.range.end), text: edit.newText ?? edit.text
      }))];
      editor.applyEdits(edits, {source: 'completion', undoStop: true});
      const shift = edits.slice(1).filter(edit => edit.end <= start).reduce((sum, edit) => sum + edit.text.length - edit.end + edit.start, 0);
      editor.goto(start + text.length + suffix.length + shift);
    }
    editor.focus();
    this.context.formatting?.afterCompletion();
    return true;
  }

  changed(change) {
    if (!this.popup.visible) return;
    const edits = change?.changes ?? change?.edits ?? [];
    if (edits.length !== 1 || edits[0].start < this.start || edits[0].end > this.end) return this.close();
    this.end = this.context.editor.offset;
    this.update();
    if (this.incomplete || this.items.some(item => item.textEdit || item.additionalTextEdits?.length)) {
      this.context.lifetime.delay('completion-refresh', () => this.context.safe(() => this.open()), 70);
    }
  }

  keydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Space') {
      this.toggleSuggestion();
      return true;
    }
    if (!this.popup.visible) return false;
    if (event.key === 'Escape') { this.close(); return true; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.index = (this.index + (event.key === 'ArrowDown' ? 1 : -1) + this.ranked.length) % this.ranked.length;
      this.render();
      return true;
    }
    if (event.key === 'Tab' || event.key === 'Enter' && !this.suggestion) return this.accept();
    const item = this.ranked[this.index]?.item;
    if (!this.suggestion && item?.commitCharacters?.includes(event.key)) return this.accept(event.key);
    return false;
  }

  close() {
    this.context.guard.cancel('completion');
    this.context.guard.cancel('completion-documentation');
    this.popup.close();
    this.context.editor.input.removeAttribute('aria-activedescendant');
    this.context.editor.input.setAttribute('aria-expanded', 'false');
  }

  dispose() { this.close(); this.popup.dispose(); }
}
