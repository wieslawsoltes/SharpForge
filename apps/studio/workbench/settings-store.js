import {WorkbenchEvents} from './events.js';
import {EDITOR_KEYMAPS} from '@sharpforge/editor';

export const settingsVersion = 2;
export const settingsKey = 'sharpforge.workbench.settings.v2';
export const settingsDefaults = Object.freeze({
  environment: {
    theme: 'dark', density: 'compact', fontFamily: 'system-ui', fontSize: 12,
    showStartWindow: true, firstRunComplete: false, keymap: 'visual-studio'
  },
  editor: {fontSize: 14, tabSize: 4, indentSize: 4, insertSpaces: true, wordWrap: false, lineNumbers: true, zoom: 100,
    endOfLine: '\n', normalizeLineEndings: false, renderWhitespace: false,
    trimTrailingWhitespace: false, insertFinalNewline: false, virtualSpace: false},
  keyboard: {bindings: []},
  debugging: {stopOnEntry: true, breakOnUnhandled: true, recordHistory: true},
  designer: {snapToGrid: true, gridSize: 8},
  runtime: {maxSessions: 4},
  projects: {configuration: 'Debug', platform: 'Any CPU', autoRecoverSeconds: 30, configurationMappings: {}},
  tasks: {tokens: [{token: 'TODO', priority: 'normal'}, {token: 'HACK', priority: 'high'}, {token: 'UNDONE', priority: 'normal'}]},
  layouts: {current: null, named: {}},
  explorer: {showAllFiles: false, followActive: true},
  tools: {scopes: {}},
  toolbars: {rows: []}
});

const allowed = Object.fromEntries(Object.entries(settingsDefaults).map(([category, values]) => [category, new Set(Object.keys(values))]));
const unsafeKey = /password|secret|token$|authorization|credential|grant|cookie|environmentVariables/i;
const clone = value => structuredClone(value);

function safeValue(value, depth = 0, inTaskToken = false) {
  if (depth > 24) throw new RangeError('Settings nesting exceeds 24');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new RangeError('Settings collection exceeds 10000 items');
    return value.map(item => safeValue(item, depth + 1, inTaskToken));
  }
  if (typeof value !== 'object') throw new TypeError('Settings must contain JSON values');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe settings property');
    if (unsafeKey.test(key) && !(key === 'token' && inTaskToken)) continue;
    result[key] = safeValue(item, depth + 1, inTaskToken);
  }
  return result;
}

/** Whitelist categories and values before persistence or export; runtime grants never enter this schema. */
export function validateSettings(input, {partial = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object');
  const output = partial ? {} : clone(settingsDefaults);
  for (const [category, values] of Object.entries(input)) {
    if (!allowed[category]) continue;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Invalid category ' + category);
    output[category] ??= {};
    for (const [key, value] of Object.entries(values)) {
      if (!allowed[category].has(key)) continue;
      const expected = settingsDefaults[category][key];
      if (expected !== null && (Array.isArray(expected) ? !Array.isArray(value) :
        typeof value !== typeof expected || typeof expected === 'object' && (value === null || Array.isArray(value)))) {
        throw new TypeError('Invalid setting type: ' + category + '.' + key);
      }
      output[category][key] = safeValue(value, 0, category === 'tasks');
    }
  }
  const environment = output.environment ?? {};
  const choices = {
    theme: ['dark', 'light', 'blue', 'high-contrast', 'system'],
    density: ['compact', 'comfortable'],
    keymap: EDITOR_KEYMAPS.map(item => item.id)
  };
  for (const [key, values] of Object.entries(choices)) {
    if (environment[key] !== undefined && !values.includes(environment[key])) throw new TypeError('Invalid ' + key);
  }
  const ending = output.editor?.endOfLine;
  if (ending !== undefined && !['\n', '\r\n', '\r'].includes(ending)) throw new RangeError('Invalid editor line ending');
  for (const [category, key, minimum, maximum] of [
    ['environment', 'fontSize', 9, 32], ['editor', 'fontSize', 8, 72], ['editor', 'tabSize', 1, 16],
    ['editor', 'indentSize', 1, 16], ['editor', 'zoom', 25, 400], ['runtime', 'maxSessions', 1, 32],
    ['projects', 'autoRecoverSeconds', 5, 3600]
  ]) {
    const value = output[category]?.[key];
    if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
      throw new RangeError(`${category}.${key} must be between ${minimum} and ${maximum}`);
    }
  }
  const bindings = output.keyboard?.bindings;
  if (bindings && (!Array.isArray(bindings) || bindings.some(binding =>
    !binding || typeof binding.id !== 'string' || typeof binding.command !== 'string' ||
    !(typeof binding.keys === 'string' || Array.isArray(binding.keys) && binding.keys.every(key => typeof key === 'string'))))) {
    throw new TypeError('Invalid custom keyboard bindings');
  }
  const tokens = output.tasks?.tokens;
  if (tokens && (!Array.isArray(tokens) || tokens.length > 64 || tokens.some(item =>
    !/^[A-Za-z][A-Za-z0-9_]{0,31}$/u.test(item.token) || !['low', 'normal', 'high'].includes(item.priority)))) {
    throw new TypeError('Task tokens must be identifiers with low, normal or high priority');
  }
  return output;
}

function mergeSettings(base, values) {
  const result = clone(base);
  for (const [category, settings] of Object.entries(values)) result[category] = {...result[category], ...settings};
  return result;
}

export class SettingsStore extends WorkbenchEvents {
  constructor({storage = globalThis.localStorage, workspaceId = 'default', notify = () => {}} = {}) {
    super();
    this.storage = storage;
    this.workspaceId = workspaceId;
    this.notify = notify;
    this.user = clone(settingsDefaults);
    this.workspace = {};
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this.snapshot();
    try {
      const raw = this.storage?.getItem(settingsKey);
      if (raw) {
        if (raw.length > 2_000_000) throw new RangeError('Stored settings exceed 2 MB');
        const payload = JSON.parse(raw);
        if (payload.version !== settingsVersion) throw new Error('Unsupported stored settings version');
        this.user = validateSettings(payload.user);
        this.workspace = validateSettings(payload.workspaces?.[this.workspaceId] ?? {}, {partial: true});
      } else this.migrate();
    } catch (error) {
      this.user = clone(settingsDefaults);
      this.workspace = {};
      this.notify({code: 'SF-WB-SETTINGS-READ', severity: 'warning', message: 'Settings reset to defaults: ' + error.message});
    }
    this.loaded = true;
    return this.snapshot();
  }

  migrate() {
    const migrated = clone(settingsDefaults);
    const read = key => {
      const raw = this.storage?.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value?.$storageVersion ? value.value : value;
    };
    const editor = read('sharpforge.editor.settings.v1');
    if (editor) {
      migrated.environment.keymap = editor.keymap ?? migrated.environment.keymap;
      Object.assign(migrated.editor, editor);
    }
    const debugging = read('sharpforge.debugger.settings.v1');
    if (debugging) Object.assign(migrated.debugging, debugging);
    migrated.layouts.current = read('sharpforge.docking.v1');
    migrated.layouts.named = read('sharpforge.named-layouts.v1') ?? {};
    const explorer = read('sharpforge.explorer.' + this.workspaceId);
    if (explorer) Object.assign(migrated.explorer, explorer);
    this.user = validateSettings(migrated);
    this.persist(this.user, this.workspace);
  }

  snapshot() { return mergeSettings(this.user, this.workspace); }
  get(category, key) {
    const overrides = this.workspace[category];
    const value = overrides && Object.hasOwn(overrides, key) ? overrides[key] : this.user[category]?.[key];
    return value !== null && typeof value === 'object' ? clone(value) : value;
  }

  persist(user, workspace) {
    if (!this.storage) return;
    let workspaces = {};
    const previous = this.storage.getItem(settingsKey);
    if (previous) {
      try { workspaces = JSON.parse(previous).workspaces ?? {}; } catch { workspaces = {}; }
    }
    const payload = {version: settingsVersion, user, workspaces: {...workspaces, [this.workspaceId]: workspace}};
    this.storage.setItem(settingsKey, JSON.stringify(payload));
  }

  /** Validate and persist once before publishing one atomic change event. */
  apply(values, {scope = 'user'} = {}) {
    if (!['user', 'workspace'].includes(scope)) throw new TypeError('Unknown settings scope');
    const changes = validateSettings(values, {partial: true});
    const user = scope === 'user' ? validateSettings(mergeSettings(this.user, changes)) : this.user;
    const workspace = scope === 'workspace' ? mergeSettings(this.workspace, changes) : this.workspace;
    this.persist(user, workspace);
    this.user = user;
    this.workspace = workspace;
    this.emit({type: 'changed', scope, settings: this.snapshot(), changes});
    return this.snapshot();
  }

  export(categories = Object.keys(settingsDefaults)) {
    const current = this.snapshot();
    const values = Object.fromEntries(categories.filter(category => allowed[category]).map(category => [category, current[category]]));
    return JSON.stringify({format: 'sharpforge-settings', version: settingsVersion, settings: validateSettings(values, {partial: true})}, null, 2);
  }

  previewImport(text) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new RangeError('Settings profile must be at most 2 MB');
    const payload = JSON.parse(text);
    if (payload.format !== 'sharpforge-settings' || !Number.isInteger(payload.version)) throw new TypeError('Invalid settings profile');
    if (payload.version > settingsVersion || payload.version < 1) throw new Error('Unsupported settings profile version ' + payload.version);
    const settings = validateSettings(payload.settings, {partial: true});
    const current = this.snapshot();
    const conflicts = [];
    for (const [category, values] of Object.entries(settings)) {
      for (const [key, value] of Object.entries(values)) {
        if (JSON.stringify(current[category]?.[key]) !== JSON.stringify(value)) {
          conflicts.push({category, key, current: current[category]?.[key], incoming: value});
        }
      }
    }
    return {settings, conflicts};
  }
}
