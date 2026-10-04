/** Bounded Vim registers and macros. No register implicitly retains an entire source document. */
export class VimRegisters {
  constructor(context, { maxCharacters = 4 * 1024 * 1024 } = {}) {
    this.context = context;
    this.maxCharacters = maxCharacters;
    this.values = new Map();
    this.macros = new Map();
  }
  async read(name = '"') {
    if (name === '+' || name === '*') {
      const text = await this.context.readClipboard();
      if (text.length > this.maxCharacters) throw new RangeError('Clipboard exceeds the register budget');
      const previous = this.values.get(name);
      return previous?.text === text ? previous : { text, linewise: false };
    }
    return this.values.get(name.toLowerCase()) ?? { text: '', linewise: false };
  }
  write(name, text, { linewise = false, block, yank = false } = {}) {
    if (!/^[a-zA-Z0-9"+*_-]$/.test(name)) throw new Error('Invalid Vim register');
    if (text.length > this.maxCharacters) throw new RangeError('Vim register exceeds the configured character budget');
    if (name === '_') return;
    const key = /^[A-Z]$/.test(name) ? name.toLowerCase() : name;
    const previous = this.values.get(key);
    const value = { text: /^[A-Z]$/.test(name) && previous ? previous.text + text : text, linewise };
    if (block && !(/^[A-Z]$/.test(name) && previous)) {
      if (!Array.isArray(block.fragments) || !block.fragments.length || block.fragments.length > 10000
        || block.fragments.some(fragment => typeof fragment !== 'string') || !Number.isSafeInteger(block.width)
        || block.width < 1 || block.width > this.maxCharacters) {
        throw new RangeError('Invalid Vim block register');
      }
      if (block.fragments.reduce((size, fragment) => size + fragment.length, 0) > this.maxCharacters
        || block.fragments.join('\n') !== text) throw new RangeError('Vim block register fragments do not match its bounded text');
      value.block = { fragments: [...block.fragments], width: block.width };
    }
    if (value.text.length > this.maxCharacters) throw new RangeError('Vim appended register exceeds the character budget');
    const commit = () => {
      this.values.set(key, value);
      this.values.set('"', value);
      if (yank) this.values.set('0', value);
      else {
        for (let number = 9; number > 1; number--) {
          const item = this.values.get(String(number - 1));
          if (item) this.values.set(String(number), item);
        }
        this.values.set(linewise || text.includes('\n') ? '1' : '-', value);
      }
    };
    if (name === '+' || name === '*') return this.context.writeClipboard(text).then(commit);
    commit();
  }
  setMacro(name, tokens) {
    if (!/^[a-zA-Z0-9]$/.test(name)) throw new Error('A macro requires a named register');
    if (tokens.length > 10000) throw new RangeError('Vim macro exceeds 10,000 keys');
    const key = name.toLowerCase();
    const value = /^[A-Z]$/.test(name) ? [...(this.macros.get(key) ?? []), ...tokens] : [...tokens];
    if (value.length > 10000) throw new RangeError('Vim macro exceeds 10,000 keys');
    this.macros.set(key, value);
  }
  dispose() { this.values.clear(); this.macros.clear(); }
}
