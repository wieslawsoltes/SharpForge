import { displayNameTokens, quoteAssemblyComponent } from './display-name-tokens.js';
import { loadError, LoadErrorCode } from './load-errors.js';

const invalid = reason => loadError(LoadErrorCode.InvalidName, reason);

function normalizeCulture(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalid('Invalid assembly culture');
  if (!value || value.toLowerCase() === 'neutral') return '';
  try { return Intl.getCanonicalLocales(value)[0]; }
  catch { throw invalid('Invalid or unsupported assembly culture'); }
}

/** Parse 2–4 unsigned 16-bit components; 65535 denotes an omitted build/revision. */
export function parseAssemblyVersion(value) {
  const parts = String(value).split('.');
  if (parts.length < 2 || parts.length > 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 65535)) {
    throw invalid('Invalid assembly version');
  }
  const numbers = parts.map(Number);
  if (numbers[0] === 65535 || numbers[1] === 65535) throw invalid('Invalid major or minor version');
  const sentinel = numbers.indexOf(65535);
  return Object.freeze(sentinel < 0 ? numbers : numbers.slice(0, sentinel));
}

function parseKey(value, token) {
  if (value.toLowerCase() === 'null' || value === '') return '';
  if (!/^(?:[\da-f]{2})+$/i.test(value) || (token && value.length !== 16)) throw invalid('Invalid public key or token');
  return value.toLowerCase();
}

const attributes = Object.freeze({
  version: (state, value) => { state.version = parseAssemblyVersion(value); },
  culture: (state, value) => {
    if (value && !/^[a-z\d_-]+$/i.test(value)) throw invalid('Invalid assembly culture');
    state.culture = value.toLowerCase() === 'neutral' ? '' : value;
  },
  publickeytoken: (state, value) => { state.publicKeyToken = parseKey(value, true); },
  publickey: (state, value) => { state.publicKey = parseKey(value, false); },
  retargetable: (state, value) => {
    if (!/^(yes|no)$/i.test(value)) throw invalid('Invalid retargetable flag');
    state.retargetable = value.toLowerCase() === 'yes';
  },
  contenttype: (state, value) => {
    if (value.toLowerCase() !== 'windowsruntime') throw invalid('Invalid assembly content type');
    state.contentType = 'WindowsRuntime';
  },
  processorarchitecture: (state, value) => {
    if (!/^(msil|x86|ia64|amd64|arm)$/i.test(value)) throw invalid('Invalid processor architecture');
    state.processorArchitecture = value.toLowerCase();
  },
});

/** Immutable partial identity. Unspecified components stay null rather than becoming wildcards by accident. */
export class AssemblyName {
  constructor({ name, version = null, culture = null, publicKeyToken = null, publicKey = null,
    retargetable = false, contentType = 'Default', processorArchitecture = null } = {}) {
    if (typeof name !== 'string' || !name || name.includes('\0')) throw invalid('Assembly name is required');
    if (contentType !== 'Default' && contentType !== 'WindowsRuntime') throw invalid('Invalid assembly content type');
    this.name = name;
    this.version = version === null ? null : parseAssemblyVersion(Array.isArray(version) ? version.join('.') : version);
    this.culture = normalizeCulture(culture);
    this.publicKeyToken = publicKeyToken === null ? null : parseKey(publicKeyToken, true);
    this.publicKey = publicKey === null ? null : parseKey(publicKey, false);
    this.retargetable = Boolean(retargetable);
    this.contentType = contentType;
    this.processorArchitecture = processorArchitecture;
    Object.freeze(this);
  }

  /** Parse CLR escaping, quotes and recognized attributes; malformed input throws SFCLR001. */
  static parse(input) {
    const next = displayNameTokens(input);
    const first = next();
    if (first.kind !== 'text' || !first.value) throw invalid('Assembly simple name is required');
    const state = { name: first.value };
    const seen = new Set();
    for (let token = next(); token.kind !== 'end'; token = next()) {
      if (token.kind !== ',') throw invalid('Expected assembly attribute separator');
      const key = next();
      const equals = next();
      const value = next();
      if (key.kind !== 'text' || !key.value || equals.kind !== '=' || value.kind !== 'text') {
        throw invalid('Expected assembly attribute and value');
      }
      const attribute = key.value.toLowerCase();
      if (!Object.hasOwn(attributes, attribute)) continue;
      const slot = attribute === 'publickey' ? 'publickeytoken' : attribute;
      if (seen.has(slot)) throw invalid(`Duplicate assembly attribute: ${key.value}`);
      seen.add(slot);
      attributes[attribute](state, value.value);
    }
    return new AssemblyName(state);
  }

  /** Canonical display name; a full key is preserved until asynchronous token derivation is requested. */
  get fullName() {
    const parts = [quoteAssemblyComponent(this.name)];
    if (this.version !== null) parts.push(`Version=${this.version.join('.')}`);
    if (this.culture !== null) parts.push(`Culture=${quoteAssemblyComponent(this.culture || 'neutral')}`);
    if (this.publicKeyToken !== null) parts.push(`PublicKeyToken=${this.publicKeyToken || 'null'}`);
    else if (this.publicKey !== null) parts.push(`PublicKey=${this.publicKey || 'null'}`);
    if (this.retargetable) parts.push('Retargetable=Yes');
    if (this.contentType === 'WindowsRuntime') parts.push('ContentType=WindowsRuntime');
    return parts.join(', ');
  }

  toString() { return this.fullName; }
}
