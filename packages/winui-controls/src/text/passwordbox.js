import { ControlEvents, ControlError } from '../policy/events.js';
import { truncateUtf16 } from './utf16.js';

/** Password storage deliberately has no enumerable text or serializable history. */
export class PasswordBuffer extends ControlEvents {
  #password = '';
  constructor({ maximumLength = 0, revealMode = 0 } = {}) {
    super();
    if (!Number.isInteger(maximumLength) || maximumLength < 0 || maximumLength > 1_048_576 || ![0, 1, 2].includes(revealMode)) {
      throw new ControlError('SFUI1621', 'Invalid password control limits or reveal mode');
    }
    this.maximumLength = maximumLength;
    this.revealMode = revealMode;
  }

  get length() { return this.#password.length; }
  read() { return this.#password; }
  set(value, { reason = 'programmatic', approved = false } = {}) {
    if (typeof value !== 'string' || value.length > 1_048_576) throw new ControlError('SFUI1621', 'Invalid password length');
    const next = this.maximumLength > 0 ? truncateUtf16(value, this.maximumLength) : value;
    if (next === this.#password) return false;
    if (!approved) {
      const args = this.emit('PasswordChanging', { Cancel: false, Length: next.length, reason });
      if (args.Cancel) return false;
    }
    this.#password = next;
    this.emit('PasswordChanged', { reason });
    return true;
  }

  toJSON() { return { redacted: true }; }
  dispose() { this.#password = ''; super.dispose(); }
}

/** Apply at every scene/debugger boundary; does not mutate the runtime object. */
export function redactPasswordProperties(type, properties) {
  if (!type.endsWith('.PasswordBox') && type !== 'PasswordBox') return { ...properties };
  const result = { ...properties };
  delete result.Password;
  delete result.SelectedText;
  result.PasswordRedacted = true;
  return result;
}
