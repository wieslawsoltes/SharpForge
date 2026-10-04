import {EditorPopup, node} from './dom.js';
import {findTextMatches} from '@sharpforge/text';
import {cooperativeLiteralSearch} from '../features/cooperative-search.js';

export class IncrementalSearchWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'incremental-search', 'search');
    this.input = node(context.document, 'input', {'aria-label': 'Incremental search', autocomplete: 'off'});
    this.status = node(context.document, 'span', {role: 'status', 'aria-live': 'polite'});
    this.popup.element.append(this.input, this.status);
    context.lifetime.listen(this.input, 'input', () => this.search());
    context.lifetime.listen(this.input, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
      if (event.key === 'Enter') { event.preventDefault(); this.close(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        this.direction = event.shiftKey ? -1 : 1;
        this.search(true);
      }
    });
  }

  open(direction = 1) {
    if (this.popup.visible) { this.direction = direction; this.search(true); return; }
    const editor = this.context.editor;
    this.origin = {uri: editor.uri, start: editor.offset, end: editor.input.selectionEnd};
    this.direction = direction;
    this.input.value = '';
    this.status.textContent = direction > 0 ? 'Incremental search forward' : 'Incremental search backward';
    this.popup.show();
    this.input.focus();
  }

  async search(repeat = false) {
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    const editor = this.context.editor;
    const source = editor.sourceSnapshot();
    const query = this.input.value;
    let result;
    try {
      result = source.length > 131_072 ? await cooperativeLiteralSearch([source], query, {signal: controller.signal}) :
        findTextMatches([source], query, {maxMatches: 10_000, signal: controller.signal});
    } catch (error) {
      if (!controller.signal.aborted) this.status.textContent = error.message;
      return;
    }
    if (controller.signal.aborted || !this.origin || editor.sourceSnapshot().version !== source.version) return;
    const origin = repeat ? this.direction > 0 ? editor.input.selectionEnd : editor.offset : this.origin.start;
    const candidates = result.matches.filter(match => this.direction > 0 ? match.start >= origin : match.end <= origin);
    const match = (this.direction > 0 ? candidates[0] : candidates.at(-1)) ??
      (this.direction > 0 ? result.matches[0] : result.matches.at(-1));
    if (!match) { this.status.textContent = this.input.value ? 'No match' : 'Type to search'; return; }
    this.context.navigate(match, {preserveFocus: true});
    this.status.textContent = `${this.direction > 0 ? 'Forward' : 'Backward'}: ${this.input.value}${candidates.length ? '' : ' · wrapped'}`;
  }

  close(cancel) {
    this.searchController?.abort();
    if (cancel && this.origin) this.context.navigate(this.origin, {preserveFocus: true});
    this.origin = null;
    this.popup.close();
    this.context.editor.focus();
  }

  dispose() { this.searchController?.abort(); this.popup.dispose(); }
}
