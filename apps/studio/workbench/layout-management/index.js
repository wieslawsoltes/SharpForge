import { mergeToolLayout } from './preserve-documents.js';
import { showLayoutDialog, promptLayoutName } from './layout-dialog.js';

/** Named window layouts persist tool placement independently of the current document set. */
export class WindowLayouts {
  constructor({ layout, storage, key, host, reset, confirmReset, onError = () => {} } = {}) {
    this.layout = layout;
    this.storage = storage;
    this.key = key;
    this.host = host;
    this.resetAction = reset;
    this.confirmReset = confirmReset;
    this.onError = onError;
    this.entries = [];
    this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      if (raw.length > 4_000_000) throw new Error('Saved window layouts exceed the size limit');
      const value = JSON.parse(raw);
      const entries = value?.$schemaVersion === 2 ? value.entries
        : Object.entries(value).map(([name, snapshot]) => ({ name, snapshot }));
      if (!Array.isArray(entries) || entries.length > 100) throw new Error('Invalid saved window layouts');
      this.entries = entries.map(entry => {
        this.validateName(entry.name);
        if (!entry.snapshot || typeof entry.snapshot !== 'object') throw new Error('Invalid saved window layout');
        return { name: entry.name, snapshot: entry.snapshot };
      });
    } catch (error) { this.entries = []; this.onError(error); }
  }

  validateName(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('Layout name must contain 1–100 characters');
  }

  persist() { this.storage?.setItem(this.key, JSON.stringify({ $schemaVersion: 2, entries: this.entries })); }
  names() { return this.entries.map(entry => entry.name); }

  save(name) {
    this.validateName(name);
    name = name.trim();
    const index = this.entries.findIndex(entry => entry.name === name);
    if (index < 0 && this.entries.length >= 100) throw new Error('Saved layout limit reached');
    const next = { name, snapshot: this.layout.snapshot() };
    const before = [...this.entries];
    if (index >= 0) this.entries[index] = next;
    else this.entries.push(next);
    try { this.persist(); } catch (error) { this.entries = before; throw error; }
    return next;
  }

  apply(name) {
    const entry = this.entries.find(item => item.name === name);
    if (!entry) throw new Error('Unknown saved window layout');
    const viewport = this.host ? { width: this.host.element.clientWidth, height: this.host.element.clientHeight } : undefined;
    const result = mergeToolLayout(this.layout, entry.snapshot, { viewport });
    this.layout.restore(result.state);
    return result.diagnostics;
  }

  applySlot(slot) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > 9) throw new RangeError('Window layout slot must be 1–9');
    const entry = this.entries[slot - 1];
    return entry ? this.apply(entry.name) : false;
  }

  remove(name) {
    const before = this.entries;
    this.entries = this.entries.filter(entry => entry.name !== name);
    try { this.persist(); } catch (error) { this.entries = before; throw error; }
    return before.length !== this.entries.length;
  }

  rename(name, nextName) {
    this.validateName(nextName);
    nextName = nextName.trim();
    if (this.entries.some(entry => entry.name === nextName && entry.name !== name)) throw new Error('A layout with that name already exists');
    const entry = this.entries.find(item => item.name === name);
    if (!entry) throw new Error('Unknown saved window layout');
    entry.name = nextName;
    try { this.persist(); } catch (error) { entry.name = name; throw error; }
  }

  async reset() {
    if (!this.confirmReset || !await this.confirmReset()) return false;
    return this.resetAction?.();
  }

  async saveDialog() {
    const name = await promptLayoutName(this.host.element.ownerDocument);
    return name === null ? false : this.save(name);
  }
  manageDialog() { return showLayoutDialog(this, this.host.element.ownerDocument); }
}
