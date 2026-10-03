import {button, element, field, input, select} from '../ui.js';
import {EDITOR_KEYMAPS} from '@sharpforge/editor';

const scopes = ['Global', 'Text Editor', 'Solution Explorer', 'Designer', 'Debugging'];

function stroke(event) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return '';
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.metaKey) modifiers.push('Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  modifiers.push(event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return modifiers.join('+');
}

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
export function keyboardConflicts(bindings, candidate) {
  const normalize = value => (Array.isArray(value) ? value.join(' ') : value).replace(/,\s*/g, ' ').toLowerCase().trim();
  return bindings.filter(binding => binding.command !== candidate.command &&
    !binding.removed && ((binding.scope ?? 'Global') === (candidate.scope ?? 'Global') ||
      (binding.scope ?? 'Global') === 'Global' || (candidate.scope ?? 'Global') === 'Global') &&
    normalize(binding.keys) === normalize(candidate.keys));
}

export function keyboardOptionsPage({registry, keybindings, schemes = EDITOR_KEYMAPS.map(item => ({value: item.id, label: item.label}))}) {
  return {id: 'Environment.keyboard', category: 'Environment', title: 'Keyboard', keywords: ['shortcuts', 'mapping', 'scheme'],
    render(host, {draft, update}) {
      const document = host.ownerDocument;
      let selected = registry.search()[0]?.id;
      let scope = 'Global';
      let recorded = [];
      const commands = element(document, 'select', {size: 8, 'aria-label': 'Commands'});
      const existing = element(document, 'select', {size: 4, 'aria-label': 'Current shortcuts'});
      const conflicts = element(document, 'p', {role: 'status'});
      const currentBindings = () => effectiveBindings(keybindings?.list() ?? [], draft.keyboard.bindings);
      const keys = input(document, 'Press shortcut keys', '', () => {}, {readonly: true});
      keys.addEventListener('keydown', event => {
        event.preventDefault();
        event.stopPropagation();
        const value = stroke(event);
        if (!value) return;
        if (recorded.length === 3) recorded = [];
        recorded.push(value);
        keys.value = recorded.join(' ');
        const matches = keyboardConflicts(currentBindings(), {command: selected, keys: keys.value, scope});
        conflicts.textContent = matches.length ? 'Already bound: ' + matches.map(item =>
          registry.describe(item.command)?.label ?? item.command).join(', ') : 'No conflicting command in this scope.';
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
        const matches = keyboardConflicts(currentBindings(), next);
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
