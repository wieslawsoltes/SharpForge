import {SyntaxHighlightIndex} from '../highlight.js';
import {EditorPopup, node, button, appendDocumentation, contentsText} from './dom.js';

export class QuickInfoWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'quick-info', 'tooltip');
    this.popup.element.tabIndex = 0;
    context.lifetime.listen(this.popup.element, 'pointerenter', () => {
      context.lifetime.cancel('hover-close');
      this.sticky = true;
    });
    context.lifetime.listen(this.popup.element, 'pointerleave', () => {
      this.sticky = false;
      this.leave();
    });
    context.lifetime.listen(context.editor.element, 'pointermove', event => this.hover(event));
    context.lifetime.listen(context.editor.element, 'pointerleave', () => this.leave());
  }

  hover(event) {
    if (this.popup.element.contains(event.target)) return;
    if (event.target.closest?.('.sf-insight-popup')) return;
    const offset = this.context.editor.view?.positionAt?.(event.clientX, event.clientY);
    if (!Number.isInteger(offset) || offset === this.hoverOffset) return;
    this.hoverOffset = offset;
    this.context.lifetime.delay('hover-open', () => this.context.safe(() => this.open(offset)), 350);
  }

  leave() {
    this.context.lifetime.cancel('hover-open');
    this.context.lifetime.delay('hover-close', () => {
      if (!this.sticky && !this.popup.element.contains(this.context.document.activeElement)) this.close();
    }, 180);
  }

  async open(offset = this.context.editor.offset, focus = false) {
    const result = await this.context.request('hover', {offset});
    if (!result) return;
    const diagnostics = (this.context.editor.diagnostics ?? []).filter(item => {
      if (item.version !== undefined && item.version !== result.revision.version) return false;
      const start = item.start ?? 0;
      const end = item.end ?? start + (item.length ?? 0);
      return start <= offset && end >= offset;
    });
    if (!result.value && !diagnostics.length) return this.close();
    const contents = contentsText(result.value?.contents ?? result.value?.signature);
    this.popup.element.replaceChildren();
    if (contents) {
      const lines = contents.split('\n');
      const signature = node(this.context.document, 'pre', {className: 'sf-quick-info-signature'});
      const index = new SyntaxHighlightIndex(lines[0]);
      for (const run of index.window().runs) signature.append(node(this.context.document, 'span',
        {className: run.kind ? `tok-${run.kind}` : ''}, lines[0].slice(run.start, run.end)));
      this.popup.element.append(signature);
      appendDocumentation(this.popup.element, lines.slice(1).join('\n'));
    }
    appendDocumentation(this.popup.element, result.value?.documentation);
    for (const diagnostic of diagnostics) {
      this.popup.element.append(node(this.context.document, 'div', {className: 'sf-quick-info-diagnostic'},
        `${diagnostic.code ?? ''} ${diagnostic.message ?? ''}`));
    }
    if (diagnostics.length && this.context.services.supports('codeActions')) {
      this.popup.element.append(button(this.context.document, 'Show potential fixes', () => {
        this.close();
        this.context.editor.goto(offset);
        this.context.safe(() => this.context.actions.open());
      }));
    }
    this.popup.show(offset);
    if (focus) this.popup.element.focus();
  }

  close() {
    this.context.guard.cancel('hover');
    this.context.lifetime.cancel('hover-open');
    this.context.lifetime.cancel('hover-close');
    this.hoverOffset = null;
    this.popup.close();
  }

  dispose() { this.close(); this.popup.dispose(); }
}
