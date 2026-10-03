const aliases = Object.freeze({
  esc: 'Escape', escape: 'Escape', return: 'Enter', enter: 'Enter', space: 'Space', spacebar: 'Space',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  del: 'Delete', delete: 'Delete', backspace: 'Backspace', tab: 'Tab', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', break: 'Pause', pause: 'Pause'
});

/** Canonical logical shortcut notation; Mod means Command on macOS, Control elsewhere. */
export function normalizeStroke(value, platform = 'windows') {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('A shortcut requires a key');
  let input = value.trim();
  if (input === ' ') input = 'Space';
  const parts = input.split('+');
  let key = parts.pop();
  if (!key && parts.at(-1) === '') { parts.pop(); key = '+'; }
  if (!key) throw new TypeError('A shortcut requires a non-modifier key');
  const modifiers = new Set();
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name === 'mod') modifiers.add(platform === 'mac' ? 'Meta' : 'Ctrl');
    else if (name === 'control' || name === 'ctrl') modifiers.add('Ctrl');
    else if (name === 'command' || name === 'cmd' || name === 'meta') modifiers.add('Meta');
    else if (name === 'option' || name === 'alt') modifiers.add('Alt');
    else if (name === 'shift') modifiers.add('Shift');
    else throw new TypeError(`Unknown shortcut modifier '${part}'`);
  }
  key = aliases[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  return [...['Ctrl', 'Meta', 'Alt', 'Shift'].filter(part => modifiers.has(part)), key].join('+');
}

// Normalize Shift+punctuation against its observed physical key only; other keyboard layouts retain their logical key.
const punctuationKeys = Object.freeze({
  Digit0: ['0', ')'], Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'],
  Digit5: ['5', '%'], Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('],
  BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
  Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'], Semicolon: [';', ':'],
  Quote: ["'", '"'], Minus: ['-', '_'], Equal: ['=', '+'], Backquote: ['`', '~']
});

/** Converts a trusted keyboard event without treating AltGraph text entry as a shortcut. */
export function eventStroke(event, platform = 'windows') {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null;
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
  let key = event.key === ' ' ? 'Space' : event.key;
  const physical = punctuationKeys[event.code];
  if (event.shiftKey && physical?.[1] === key) key = physical[0];
  if (typeof key !== 'string' || !key) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key === '+' ? '+' : key);
  return normalizeStroke(parts.join('+'), platform);
}

export function normalizeSequence(value, platform = 'windows') {
  const keys = Array.isArray(value) ? value : String(value).trim().split(/\s*,\s+|\s+/);
  if (!keys.length || keys.length > 4) throw new RangeError('A shortcut contains one to four key strokes');
  return keys.map(key => normalizeStroke(key, platform));
}

export const browserReservedBindings = Object.freeze([
  { command: 'Window.CloseDocumentWindow', reserved: 'Mod+W', alternate: 'Mod+F4' },
  { command: 'File.NewFile', reserved: 'Mod+N', alternate: 'Mod+Alt+N' },
  { command: 'Edit.NavigateTo', reserved: 'Mod+T', alternate: 'Mod+,' },
  { command: 'Window.NextDocumentWindowNav', reserved: 'Ctrl+Tab', alternate: 'Ctrl+F6' },
  { command: 'Window.PreviousDocumentWindowNav', reserved: 'Ctrl+Shift+Tab', alternate: 'Ctrl+Shift+F6' },
  { command: 'File.OpenFile', reserved: 'Mod+O', alternate: 'Mod+Alt+O' }
]);

/** Documentation data, since browsers may intercept reserved keys before JavaScript. */
export function platformBindingInventory(platform = 'windows') {
  return browserReservedBindings.map(binding => ({
    ...binding, platform, reserved: normalizeStroke(binding.reserved, platform),
    alternate: normalizeStroke(binding.alternate, platform), browserMayIntercept: true
  }));
}
