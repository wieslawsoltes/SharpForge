import { createPart, registerFamily, stateFor, ControlError } from '../policy/events.js';
import { requestControlEvent } from '../policy/event-requests.js';
import { showControlOverlay, hideControlOverlay } from '../overlay/index.js';
import { TextCommandController, textCommandLabels } from './text-command.js';
import { commandTemplateChildren } from './layout-parts.js';
import { menuEvent } from './menu-events.js';

function flyoutState(context, node) {
  return stateFor(context, node, 'text-command-flyout', () => ({ target: null, controller: null,
    dispose() { this.controller?.dispose(); this.controller = null; this.target = null; } }));
}

function targetController(context, node, target) {
  const id = target?.$ref ?? target?.closest?.('[data-sf-id]')?.dataset.sfId;
  const owner = context.nodes.get(id), descriptor = owner && context.host.registry.resolve(owner.type);
  if (!owner || !/\.(?:TextBox|AutoSuggestBox|RichEditBox)$/.test(owner.type) || !descriptor?.getTextModel) {
    throw new ControlError('SFUI1655', 'TextCommandBarFlyout requires a supported text editor target');
  }
  context.host.ensure(owner.id);
  const state = flyoutState(context, node);
  state.controller?.dispose(); state.target = owner;
  state.controller = new TextCommandController({ model: descriptor.getTextModel(context, owner), clipboard: context.services.clipboard,
    readOnly: () => owner.properties.IsReadOnly || owner.properties.IsEnabled === false,
    beforePaste: async options => {
      if (!owner.events?.includes('Paste')) return true;
      const result = await requestControlEvent(context, owner, 'Paste', { Handled: false, Cancel: false }, options);
      return !result.Handled && !result.Cancel;
    },
    beforeEdit: async (text, options) => {
      if (!owner.events?.includes('BeforeTextChanging')) return true;
      const result = await requestControlEvent(context, owner, 'BeforeTextChanging', { NewText: text, Cancel: false }, options);
      return !result.Cancel;
    }, onChanged: () => { context.invalidate(owner.id); context.invalidate(node.id); } });
  return state;
}

function renderTextFlyout(context, node, element) {
  const state = flyoutState(context, node), custom = element.lastElementChild;
  for (const button of element.querySelectorAll('[data-text-command]')) {
    button.disabled = !state.controller?.enabled(button.dataset.textCommand);
  }
  const references = [...(node.collections.PrimaryCommands ?? []), ...(node.collections.SecondaryCommands ?? [])];
  context.ordered(custom, references.map(value => context.host.ensure(value.$ref)).filter(Boolean));
  element.setAttribute('role', 'menu');
}

export function registerTextCommandFlyout(registry) {
  registerFamily(registry, 'TextCommandBarFlyout', {
    create(context) {
      const root = createPart(context.document, 'div', 'text-command-menu');
      for (const [name, label] of Object.entries(textCommandLabels)) {
        const button = createPart(context.document, 'button', 'text-command');
        button.dataset.textCommand = name; button.textContent = label; button.setAttribute('role', 'menuitem');
        Object.assign(button.style, { display: 'block', width: '100%', minHeight: '32px', textAlign: 'start' });
        root.append(button);
      }
      root.append(createPart(context.document, 'div', 'text-custom-commands'));
      return root;
    }, render: renderTextFlyout, getTemplatePartChildren: commandTemplateChildren,
    overlayClosed(context, node) { flyoutState(context, node).controller?.dispose(); },
    afterLayout(context, node, element) {
      const layout = context.host.layoutEngine?.states.get(node.id)?.data.textCommandLayout;
      if (!layout) return;
      const root = context.getState(node).familyTemplate?.root ?? element;
      for (const button of root.querySelectorAll('[data-text-command]')) button.style.height = layout.rowHeight + 'px';
    },
    invoke(context, node, element, method, args = []) {
      if (method === 'ShowAt') {
        targetController(context, node, args[0]);
        renderTextFlyout(context, node, element);
        return showControlOverlay(context, node, { target: context.host.ensure(flyoutState(context, node).target.id) });
      }
      if (method === 'Hide') return hideControlOverlay(context, node);
      return undefined;
    }, events: {
      click(context, node, element, event) {
        const button = event.target.closest('[data-text-command]');
        if (!button || button.disabled) return false;
        event.preventDefault();
        const state = flyoutState(context, node);
        const action = state.controller.execute(button.dataset.textCommand);
        renderTextFlyout(context, node, element);
        action.then(async result => {
          if (!result.ok) {
            element.dataset.commandResult = result.reason ?? 'permission-denied';
            renderTextFlyout(context, node, element);
            return;
          }
          delete element.dataset.commandResult;
          await hideControlOverlay(context, node);
          const model = state.controller.model, selection = model.selection ?? { start: model.selectionStart, length: model.selectionLength };
          context.host.invoke(state.target.id, 'SelectText', [selection.start, selection.length]);
        }).catch(error => { if (error.name !== 'AbortError') context.host.options.onError?.(error); });
        return true;
      }, keydown: menuEvent
    }
  });
}
