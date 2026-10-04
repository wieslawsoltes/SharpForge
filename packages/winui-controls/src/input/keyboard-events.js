import { modifierFlags } from './pointer-events.js';

const keys = { Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20,
  Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38,
  ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46, Meta: 91, ContextMenu: 93,
  NumLock: 144, ScrollLock: 145, ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192,
  '[': 219, '\\': 220, ']': 221, "'": 222 };

export function virtualKey(event) {
  if (keys[event.key] !== undefined) return keys[event.key];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(event.code)) return 96 + Number(event.code.at(-1));
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return 111 + Number(event.key.slice(1));
  return 0;
}

export function keyboardEventArgs(event) {
  const key = virtualKey(event);
  return { Key: key, OriginalKey: key, KeyModifiers: modifierFlags(event),
    KeyStatus: { RepeatCount: 1, ScanCode: Number.isInteger(event.scanCode) ? event.scanCode : 0,
      IsExtendedKey: event.isExtendedKey === true,
      IsMenuKeyDown: !!event.altKey, WasKeyDown: !!event.repeat, IsKeyReleased: event.type === 'keyup' },
    Character: event.key?.length === 1 ? event.key : null, IsComposing: !!event.isComposing };
}

export const VirtualKey = Object.freeze(Object.fromEntries(Object.entries(keys).map(([name, value]) => [name, value])));
