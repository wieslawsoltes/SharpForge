import {EditorPopup, node, button} from './dom.js';
import {serviceItems} from '../services/providers.js';
import {prepareWorkspaceEdit, commitWorkspaceEdit} from '../services/workspace-edit.js';
import {createSideBySideDiff} from '../diff/side-by-side.js';

export class CodeActionsWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'code-actions');
    this.bulb = button(context.document, '💡', () => context.safe(() => this.open()),
      {className: 'sf-action-bulb', 'aria-label': 'Show potential fixes and refactorings', hidden: true});
    this.inlineBulb = button(context.document, '💡', () => context.safe(() => this.open()),
      {className: 'sf-inline-action-bulb', 'aria-label': 'Inline potential fixes and refactorings'});
    context.editor.element.append(this.bulb);
    this.items = [];
  }

  async refresh(open = false, scope) {
    if (!this.context.services.supports('codeActions') || this.context.editor.input.readOnly) return;
    const editor = this.context.editor;
    const offset = editor.offset;
    const result = await this.context.request('codeActions', {offset, end: editor.input.selectionEnd, scope});
    if (!result || offset !== editor.offset) return;
    this.items = serviceItems(result.value);
    this.versions = result.versions;
    this.bulb.hidden = !this.items.length;
    editor.setInlineWidgets?.('code-actions', this.items.length ? [{offset, node: this.inlineBulb, placement: 'inline'}] : []);
    this.position();
    if (open) this.showMenu(this.items);
  }

  open() { return this.refresh(true); }

  showMenu(items, parent) {
    this.preview?.dispose();
    this.preview = null;
    const document = this.context.document;
    this.popup.element.replaceChildren(node(document, 'strong', {}, parent?.title ?? 'Quick Actions and Refactorings'));
    if (!items.length) this.popup.element.append(node(document, 'p', {}, 'No actions are available at this location.'));
    if (parent) this.popup.element.append(button(document, '← Back', () => this.showMenu(this.items)));
    for (const item of items) {
      const action = button(document, `${item.kind?.startsWith('refactor') ? '⌁ ' : ''}${item.title}`, () => {
        if (item.children?.length) this.showMenu(item.children, item);
        else this.context.safe(() => this.select(item));
      }, {disabled: Boolean(item.disabled), title: item.disabled?.reason ?? ''});
      this.popup.element.append(action);
    }
    this.popup.show();
    this.popup.element.querySelector('button')?.focus();
  }

  async select(item) {
    let action = item;
    if (!action.edit && !action.edits && this.context.services.supports('resolveCodeAction')) {
      const result = await this.context.request('resolveCodeAction', {action});
      if (!result) return;
      action = result.value;
    }
    if (action.command && !action.edit && !action.edits) {
      await this.context.command(action.command);
      return this.close();
    }
    const plan = prepareWorkspaceEdit(this.context.workspace, action.edit ?? action, {versions: this.versions, label: action.title});
    this.showPreview(action, plan);
  }

  showPreview(action, plan) {
    const document = this.context.document;
    this.popup.element.replaceChildren(node(document, 'strong', {}, action.title));
    const select = node(document, 'select', {'aria-label': 'Preview document'});
    for (const change of plan.changes) select.append(node(document, 'option', {value: change.uri}, change.uri));
    const host = node(document, 'div', {className: 'sf-action-preview'});
    const show = () => {
      const change = plan.changes.find(item => item.uri === select.value) ?? plan.changes[0];
      this.preview?.dispose();
      if (change) this.preview = createSideBySideDiff(host, {original: change.before, modified: change.text});
    };
    select.addEventListener('change', show);
    this.popup.element.append(select, host, button(document, 'Apply', () => this.context.safe(async () => {
      await commitWorkspaceEdit(this.context.workspace, plan);
      if (action.command) await this.context.command(action.command);
      this.close();
      this.context.editor.focus();
    })), button(document, 'Back', () => this.showMenu(this.items)));
    for (const scope of action.fixAllScopes ?? []) {
      if (!['document', 'project', 'solution'].includes(scope)) continue;
      this.popup.element.append(button(document, `Fix all in ${scope}`, () => this.context.safe(() => this.refresh(true, scope))));
    }
    show();
    this.popup.show();
  }

  position() {
    const coordinates = this.context.editor.view?.coordsAt?.(this.context.editor.offset);
    this.bulb.style.top = `${coordinates?.top ?? 0}px`;
    this.popup.position();
  }

  close() {
    this.context.guard.cancel('codeActions');
    this.context.guard.cancel('resolveCodeAction');
    this.popup.close();
    this.preview?.dispose();
    this.preview = null;
  }

  changed() { this.close(); this.bulb.hidden = true; this.context.editor.setInlineWidgets?.('code-actions', []); }
  dispose() { this.changed(); this.bulb.remove(); this.inlineBulb.remove(); this.popup.dispose(); }
}
