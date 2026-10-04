import {EditorPopup, node, button, checkbox, labeledInput, uniqueDomId} from './dom.js';
import {EditorSearchSession} from '../features/search-session.js';
import {commitWorkspaceEdit} from '../services/workspace-edit.js';
import {createSideBySideDiff} from '../diff/side-by-side.js';

export class FindReplaceWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'find-replace', 'search');
    this.session = new EditorSearchSession(context.workspace);
    this.find = labeledInput(context.document, 'Find in current file', {placeholder: 'Find'});
    this.replacement = labeledInput(context.document, 'Replace in current file', {placeholder: 'Replace with'});
    this.history = node(context.document, 'datalist', {id: uniqueDomId(context.document, 'sf-find-history')});
    this.find.input.setAttribute('list', this.history.id);
    this.case = checkbox(context.document, 'Match case');
    this.word = checkbox(context.document, 'Whole word');
    this.regex = checkbox(context.document, 'Regular expression');
    this.preserve = checkbox(context.document, 'Preserve case');
    this.scope = node(context.document, 'select', {'aria-label': 'Search scope'});
    for (const [value, label] of [['document', 'Document'], ['selection', 'Selection'], ['open', 'All open documents']]) {
      this.scope.append(node(context.document, 'option', {value}, label));
    }
    this.status = node(context.document, 'span', {role: 'status', 'aria-live': 'polite', className: 'sf-find-count'});
    this.previewHost = node(context.document, 'div', {className: 'sf-find-preview', hidden: true});
    this.replaceRow = node(context.document, 'div', {className: 'sf-find-replace-row', hidden: true});
    this.replaceRow.append(this.replacement.wrapper, this.preserve.wrapper,
      button(context.document, 'Replace', () => context.safe(() => this.replace(false))),
      button(context.document, 'Replace all', () => context.safe(() => this.replace(true))),
      button(context.document, 'Preview replacements', () => context.safe(() => this.preview())));
    this.popup.element.append(this.find.wrapper, this.history, this.case.wrapper, this.word.wrapper, this.regex.wrapper, this.scope,
      button(context.document, 'Previous', () => this.next(false, -1)), button(context.document, 'Next', () => this.next()),
      button(context.document, 'Close', () => this.close()), this.replaceRow, this.status, this.previewHost);
    context.lifetime.listen(this.find.input, 'input', () => this.search(true));
    for (const field of [this.case.input, this.word.input, this.regex.input, this.preserve.input, this.scope]) {
      context.lifetime.listen(field, 'change', () => this.search(true));
    }
    context.lifetime.listen(this.popup.element, 'keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.target === this.replacement.input) context.safe(() => this.replace(event.ctrlKey || event.metaKey));
        else this.next(false, event.shiftKey ? -1 : 1);
      }
      if (event.key === 'Escape') this.close();
    });
    this.index = -1;
  }

  open(replace = false) {
    const editor = this.context.editor;
    this.selection = {start: editor.offset, end: editor.input.selectionEnd};
    if (this.selection.start !== this.selection.end && this.selection.end - this.selection.start <= 1024) {
      const source = editor.sourceSnapshot();
      const selected = source.getText?.(this.selection.start, this.selection.end) ?? source.text.slice(this.selection.start, this.selection.end);
      if (!/[\r\n]/.test(selected)) this.find.input.value = selected;
    }
    this.replaceRow.hidden = !replace;
    this.scope.querySelector('[value="selection"]').disabled = this.selection.start === this.selection.end;
    this.popup.show();
    this.find.input.focus();
    this.find.input.select();
    return this.search(false);
  }

  search(select = false) {
    this.pendingSearch = this.runSearch(select);
    return this.pendingSearch;
  }

  async runSearch(select = false) {
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    this.session.matches = [];
    this.index = -1;
    this.previewDiff?.dispose();
    this.previewDiff = null;
    this.previewHost.hidden = true;
    const editor = this.context.editor;
    editor.setDecorations?.('find', this.scope.value === 'selection' ? [{...this.selection, className: 'sf-search-scope'}] : []);
    try {
      const settings = {uri: editor.uri, regex: this.regex.input.checked,
        matchCase: this.case.input.checked, wholeWord: this.word.input.checked, preserveCase: this.preserve.input.checked,
        scope: this.scope.value, selection: this.selection, signal: controller.signal,
        workerFactory: this.context.options.searchWorkerFactory,
        onProgress: progress => {
          if (controller.signal.aborted) return;
          const percentage = Math.floor(progress.processed / Math.max(1, progress.total) * 100);
          const message = `Searching… ${percentage}%`;
          if (this.status.textContent !== message) this.status.textContent = message;
        }};
      const large = this.scope.value === 'open' || (editor.model?.length ?? editor.value.length) > 131_072;
      this.popup.element.dataset.searchState = 'searching';
      const result = large ? await this.session.searchAsync(this.find.input.value, settings) :
        this.session.search(this.find.input.value, settings);
      if (controller.signal.aborted || this.searchController !== controller) return;
      this.popup.element.dataset.searchState = 'complete';
      this.popup.element.dataset.searchBackend = result.backend ?? 'bounded-synchronous';
      this.index = -1;
      const decorations = result.matches.filter(match => match.uri === editor.uri).map(match => ({...match, className: 'sf-search-match'}));
      if (this.scope.value === 'selection') decorations.push({...this.selection, className: 'sf-search-scope'});
      editor.setDecorations?.('find', decorations);
      this.status.textContent = `${result.matches.length}${result.truncated ? '+' : ''} matches`;
      if (select && result.matches.length) this.next(true);
      return result;
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') return;
      this.session.matches = [];
      this.popup.element.dataset.searchState = 'error';
      editor.setDecorations?.('find', []);
      this.status.textContent = `${error.code ?? 'Search'}: ${error.message}`;
    }
  }

  async next(reset = false, direction = 1) {
    if (!this.popup.visible) await this.open(false);
    if (this.popup.element.dataset.searchState === 'searching') await this.pendingSearch;
    if (!this.popup.visible || this.popup.element.dataset.searchState !== 'complete') return;
    const matches = this.session.matches;
    if (!matches.length) return;
    if (reset || this.index < 0) {
      const offset = this.context.editor.offset;
      const uri = this.context.editor.uri;
      const candidates = matches.map((match, index) => ({match, index})).filter(item => item.match.uri === uri &&
        (direction > 0 ? item.match.start >= offset : item.match.end <= offset));
      this.index = (direction > 0 ? candidates[0] : candidates.at(-1))?.index ?? (direction > 0 ? 0 : matches.length - 1);
    } else this.index = (this.index + direction + matches.length) % matches.length;
    const match = matches[this.index];
    this.context.navigate(match, {preserveFocus: true});
    this.status.textContent = `${this.index + 1} of ${matches.length}${this.session.truncated ? '+' : ''} matches`;
    this.session.remember();
    this.history.replaceChildren(...this.session.history.map(query => node(this.context.document, 'option', {value: query})));
    return match;
  }

  async replace(all = false) {
    if (this.context.editor.input.readOnly) return;
    if (this.popup.element.dataset.searchState !== 'complete') return this.context.status('Wait for the current search to finish.');
    if (!all && this.index < 0) await this.next(true);
    const matches = all ? this.session.matches : this.session.matches[this.index] ? [this.session.matches[this.index]] : [];
    const plan = this.session.prepareReplacement(this.replacement.input.value, matches);
    await commitWorkspaceEdit(this.context.workspace, plan);
    this.search(true);
  }

  preview() {
    if (this.popup.element.dataset.searchState !== 'complete') throw new Error('Wait for the current search to finish.');
    const plan = this.session.prepareReplacement(this.replacement.input.value);
    this.previewHost.hidden = false;
    this.previewHost.replaceChildren();
    const select = node(this.context.document, 'select', {'aria-label': 'Replacement preview document'});
    for (const change of plan.changes) select.append(node(this.context.document, 'option', {value: change.uri}, change.uri));
    const host = node(this.context.document, 'div', {className: 'sf-action-preview'});
    const show = () => {
      this.previewDiff?.dispose();
      const change = plan.changes.find(item => item.uri === select.value) ?? plan.changes[0];
      if (change) this.previewDiff = createSideBySideDiff(host, {original: change.before, modified: change.text});
    };
    select.addEventListener('change', show);
    this.previewHost.append(select, host, button(this.context.document, 'Apply replacements', () => this.context.safe(async () => {
      await commitWorkspaceEdit(this.context.workspace, plan);
      this.search(true);
    })));
    show();
  }

  changed() { if (this.popup.visible) this.search(false); }

  close() {
    this.searchController?.abort();
    this.popup.close();
    this.previewDiff?.dispose();
    this.previewDiff = null;
    this.context.editor.setDecorations?.('find', []);
    this.context.editor.focus();
  }

  dispose() {
    this.searchController?.abort();
    this.previewDiff?.dispose();
    this.context.editor.setDecorations?.('find', []);
    this.popup.dispose();
  }
}
