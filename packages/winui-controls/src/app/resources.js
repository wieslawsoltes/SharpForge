import { ControlEvents, ControlError } from '../policy/events.js';
import { languageFallbacks } from './resw.js';

/** .resw-equivalent string dictionaries with ordinal keys and BCP-47 fallback. */
export class ResourceLoader extends ControlEvents {
  constructor({ resources = {}, language = 'en-US', fallbackLanguage = 'en-US' } = {}) {
    super();
    this.resources = new Map(Object.entries(resources).map(([locale, entries]) =>
      [Intl.getCanonicalLocales(locale)[0], new Map(Object.entries(entries))]));
    this.language = Intl.getCanonicalLocales(language)[0];
    this.fallbackLanguage = Intl.getCanonicalLocales(fallbackLanguage)[0];
    this.bindings = new Set();
    this.uidKeys = new Map();
    for (const entries of this.resources.values()) for (const key of entries.keys()) {
      const separator = key.lastIndexOf('.');
      if (separator <= 0) continue;
      const uid = key.slice(0, separator);
      if (!this.uidKeys.has(uid)) this.uidKeys.set(uid, new Set());
      this.uidKeys.get(uid).add(key);
    }
  }
  getString(key, languageOverride = this.language) {
    if (typeof key !== 'string') throw new ControlError('SFUI1692', 'Resource key must be a string');
    const languages = new Set([...languageFallbacks(languageOverride), ...languageFallbacks(this.fallbackLanguage)]);
    for (const language of languages) {
      const value = this.resources.get(language)?.get(key);
      if (value !== undefined) return String(value);
    }
    return '';
  }
  setLanguage(language) {
    const canonical = Intl.getCanonicalLocales(language)[0];
    if (canonical === this.language) return;
    this.language = canonical;
    for (const binding of this.bindings) this.applyUid(binding.uid, binding.write);
    this.emit('LanguageChanged', { Language: canonical });
  }
  applyUid(uid, write) {
    for (const key of this.uidKeys.get(uid) ?? []) write(key.slice(uid.length + 1), this.getString(key));
  }
  bindUid(uid, write, { retainedValues = () => [] } = {}) {
    if (typeof uid !== 'string' || typeof write !== 'function') {
      throw new ControlError('SFUI1692', 'A resource binding requires a UID and a property writer');
    }
    const binding = { uid, write };
    this.bindings.add(binding);
    this.applyUid(uid, write);
    const dispose = () => this.bindings.delete(binding);
    dispose.dispose = dispose;
    dispose.snapshot = () => ({ version: 1, active: this.bindings.has(binding) });
    dispose.restore = snapshot => {
      if (snapshot?.version !== 1) throw new ControlError('SFUI1692', 'Invalid resource-binding snapshot');
      if (snapshot.active) this.bindings.add(binding);
      else this.bindings.delete(binding);
    };
    dispose.retainedValues = function* () { yield* retainedValues(); };
    return dispose;
  }
  snapshot() { return { version: 1, language: this.language }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1692', 'Invalid resource-loader snapshot');
    this.language = Intl.getCanonicalLocales(snapshot.language)[0];
  }
  dispose() { this.bindings.clear(); super.dispose(); }
}
