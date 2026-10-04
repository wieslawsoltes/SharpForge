import {button, element, field, input, select} from '../ui.js';
import {EDITOR_KEYMAPS, KeybindingService, eventStroke} from '@sharpforge/editor';

const scopes = ['Global', 'Text Editor', 'Solution Explorer', 'Designer', 'Debugging'];

export const shortcutStroke = eventStroke;

/** Apply persisted replacements and removals by stable binding id before editing or resolving shortcuts. */
export function effectiveBindings(defaults, overrides) {
  const result = new Map(defaults.map(binding => [binding.id, binding]));
  for (const binding of overrides) {
    const id = binding.removed ? binding.id.replace(/^removed:/u, '') : binding.id;
    if (binding.removed) result.delete(id);
    else result.set(id, binding);
  }
  return [...result.values()];
}

/** Global bindings overlap editor/tool scopes; unrelated specific scopes remain independent. */
export function keyboardConflicts(bindings, candidate, {platform = 'windows'} = {}) {
  const service = new KeybindingService({execute() {}, platform});
  try {
    service.setBindings(bindings.filter(binding => !binding.removed).map((binding, index) => ({
      ...binding, id: binding.id ?? 'options-binding:' + index, scope: binding.scope ?? 'Global'
    })));
    return service.conflicts({...candidate, scope: candidate.scope ?? 'Global'}).filter(conflict =>
      conflict.kind === 'prefix' || conflict.right.command !== candidate.command).map(conflict => ({
      ...conflict.right, kind: conflict.kind, shadowing: conflict.shadowing
    }));
  } finally { service.dispose(); }
}

export function keyboardOptionsPage({registry, keybindings, schemes = EDITOR_KEYMAPS.map(item => ({value: item.id, label: item.label}))}) {
  return {id: 'Environment.keyboard', category: 'Environment', title: 'Keyboard', keywords: ['shortcuts', 'mapping', 'scheme'],
    render(host, {draft, update}) {
      const document = host.ownerDocument;
      const bindingOptions = {platform: keybindings?.platform ?? keybindings?.configuration?.platform ?? 'windows'};
      let selected = registry.search()[0]?.id;
      let scope = 'Global';
      let recorded = [];
      const commands = element(document, 'select', {size: 8, 'aria-label': 'Commands'});
      const existing = element(document, 'select', {size: 4, 'aria-label': 'Current shortcuts'});
      const conflicts = element(document, 'p', {role: 'status'});
      const currentBindings = () => effectiveBindings(keybindings?.list() ?? [], draft.keyboard.bindings);
      const keys = input(document, 'Press shortcut keys', '', () => {}, {readonly: true, 'data-shortcut-recorder': 'true'});
      keys.addEventListener('keydown', event => {
        const value = eventStroke(event, bindingOptions.platform);
        if (!value) return;
        event.preventDefault();
        event.stopPropagation();
        if (recorded.length === 3) recorded = [];
        recorded.push(value);
        keys.value = recorded.join(' ');
        const matches = keyboardConflicts(currentBindings(), {command: selected, keys: keys.value, scope}, bindingOptions);
        conflicts.textContent = matches.length ? 'Already bound: ' + matches.map(item =>
          (registry.describe(item.command)?.label ?? item.command) + (item.kind === 'prefix' ? ' (chord prefix)' : '')).join(', ') :
          'No conflicting command in this scope.';
      });
      const renderCurrent = () => {
        existing.replaceChildren();
        for (const [index, binding] of currentBindings().entries()) {
          if (binding.command !== selected) continue;
          const label = (Array.isArray(binding.keys) ? binding.keys.join(' ') : binding.keys) + ' (' + (binding.scope ?? 'Global') + ')';
          existing.append(element(document, 'option', {value: index, text: label}));
        }
      };
      const renderCommands = query => {
        commands.replaceChildren();
        for (const command of registry.search(query)) commands.append(element(document, 'option', {value: command.id, text: command.label}));
        commands.value = selected;
        if (!commands.value) selected = commands.value = commands.options[0]?.value ?? '';
        renderCurrent();
      };
      commands.addEventListener('change', () => { selected = commands.value; renderCurrent(); });
      const search = input(document, 'Search commands', '', renderCommands, {placeholder: 'Search commands'});
      host.append(field(document, 'Mapping scheme', select(document, 'Mapping scheme', schemes, draft.environment.keymap,
        value => update('environment', 'keymap', value))), search, commands, existing);
      host.append(field(document, 'Use new shortcut in', select(document, 'Shortcut scope', scopes, scope, value => { scope = value; })));
      host.append(field(document, 'Press shortcut keys', keys), conflicts);
      const actions = element(document, 'div', {className: 'wb-actions'});
      actions.append(button(document, 'Clear keys', () => { recorded = []; keys.value = ''; conflicts.textContent = ''; }));
      actions.append(button(document, 'Assign', () => {
        if (!selected || !keys.value) return;
        const next = {id: 'custom:' + selected + ':' + scope, command: selected, keys: keys.value, scope, priority: 100};
        const matches = keyboardConflicts(currentBindings(), next, bindingOptions);
        if (matches.length) { conflicts.textContent = 'Remove the conflicting binding before assigning this shortcut.'; return; }
        update('keyboard', 'bindings', [...draft.keyboard.bindings.filter(item => item.id !== next.id), next]);
        renderCurrent();
      }));
      actions.append(button(document, 'Remove', () => {
        const binding = currentBindings()[Number(existing.value)];
        if (!binding) return;
        const own = draft.keyboard.bindings.find(item => item === binding);
        if (own) update('keyboard', 'bindings', draft.keyboard.bindings.filter(item => item !== own));
        else update('keyboard', 'bindings', [...draft.keyboard.bindings, {...binding, id: 'removed:' + binding.id, removed: true}]);
        renderCurrent();
      }));
      actions.append(button(document, 'Reset custom bindings', () => { update('keyboard', 'bindings', []); renderCurrent(); }));
      host.append(actions);
      renderCommands('');
    }};
}
