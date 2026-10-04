import {EditorPopup, node} from './dom.js';
import {findLiteralMatchAsync} from '@sharpforge/text';

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
    if (this.disposed) return;
    if (this.popup.visible) {
      this.direction = direction;
      this.search(true);
      return;
    }
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
    if (this.disposed || !this.origin || this.context.editor.disposed) return;
    const controller = new AbortController();
    this.searchController = controller;
    const editor = this.context.editor;
    const model = editor.model;
    const source = editor.sourceSnapshot();
    const query = this.input.value;
    const capturedOrigin = this.origin;
    if (!capturedOrigin || capturedOrigin.uri !== editor.uri) return;
    const direction = this.direction;
    const origin = repeat ? direction > 0 ? editor.input.selectionEnd : editor.offset : capturedOrigin.start;
    const current = () => !controller.signal.aborted && this.searchController === controller
      && this.origin === capturedOrigin && !this.disposed && !editor.disposed
      && editor.model === model && editor.uri === source.uri && model.version === source.version;
    try {
      const result = await findLiteralMatchAsync(source, query, {
        ...this.context.options?.searchNavigation, origin, direction, signal: controller.signal
      });
      if (!current()) return;
      if (!result.match) {
        this.status.textContent = query ? 'No match' : 'Type to search';
        return;
      }
      await this.context.navigate(result.match, {preserveFocus: true, signal: controller.signal});
      if (current()) this.status.textContent = `${direction > 0 ? 'Forward' : 'Backward'}: ${query}${result.wrapped ? ' · wrapped' : ''}`;
    } catch (error) {
      if (current()) this.status.textContent = error.message;
    }
  }

  close(cancel) {
    this.searchController?.abort();
    if (cancel && this.origin) {
      const origin = this.origin;
      this.context.safe(() => this.context.navigate(origin, {preserveFocus: true}));
    }
    this.origin = null;
    this.popup.close();
    this.context.editor.focus();
  }

  dispose() {
    this.disposed = true;
    this.origin = null;
    this.searchController?.abort();
    this.popup.dispose();
  }
}
