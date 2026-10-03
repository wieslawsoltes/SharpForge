import {authoringError, finiteNumber} from './property-diagnostics.js';
import {validateGuideSettings} from './guides-document.js';

export const designerOptionsKey = 'sharpforge.designer.settings.v1';
export const defaultDesignerOptions = Object.freeze({version: 1, defaultView: 'design', splitOrientation: 'vertical',
  snap: 8, zoom: 0.8, autoSync: true, naming: 'type', arrange: 'category', collapsed: Object.freeze({})});

export function validateDesignerOptions(value) {
  const result = {...defaultDesignerOptions, ...value};
  if (result.version !== 1 || !['design', 'split', 'code'].includes(result.defaultView) ||
    !['vertical', 'horizontal'].includes(result.splitOrientation) || !['type', 'camelCase', 'none'].includes(result.naming) ||
    !['category', 'name', 'source'].includes(result.arrange) || typeof result.autoSync !== 'boolean') {
    authoringError('SFD1864', 'Invalid designer options.');
  }
  result.snap = finiteNumber(result.snap, {label: 'Snap distance', minimum: 1, maximum: 64, integer: true});
  result.zoom = finiteNumber(result.zoom, {label: 'Default zoom', minimum: 0.1, maximum: 4});
  if (!result.collapsed || Array.isArray(result.collapsed) || typeof result.collapsed !== 'object' ||
    Object.keys(result.collapsed).length > 10000 || Object.values(result.collapsed).some(value => typeof value !== 'boolean')) {
    authoringError('SFD1864', 'Invalid property-category collapse state.');
  }
  result.collapsed = {...result.collapsed};
  return result;
}

/** Creation-only initialization returns a clone and never overwrites serialized or recovered guide settings. */
export function initializeDesignerDocumentOptions(input, options) {
  const value = structuredClone(input);
  const settings = validateDesignerOptions(options);
  if (value.designer?.guides === undefined) {
    value.designer ??= {};
    value.designer.guides = validateGuideSettings({gridSize: settings.snap});
  }
  return value;
}

/** The existing settings service owns persistence. Failed writes are reported before state changes. */
export class DesignerOptionsService {
  constructor(settings, {key = designerOptionsKey} = {}) {
    this.settings = settings;
    this.key = key;
    this.value = validateDesignerOptions({});
  }

  load() {
    if (!this.settings?.getItem) return {...this.value};
    const raw = this.settings.getItem(this.key);
    if (raw !== null) this.value = validateDesignerOptions(JSON.parse(raw));
    return structuredClone(this.value);
  }

  update(changes) {
    const value = validateDesignerOptions({...this.value, ...changes});
    if (!this.settings?.setItem) authoringError('SFD1864', 'Designer settings persistence is unavailable.');
    this.settings.setItem(this.key, JSON.stringify(value));
    this.value = value;
    return structuredClone(value);
  }

  applyToNewDocument(view) {
    view.zoom = this.value.zoom;
    view.snap = this.value.snap;
    view.autoSync = this.value.autoSync;
    view.sourceSync?.setAuto?.(this.value.autoSync);
    view.naming = this.value.naming;
    return {mode: this.value.defaultView, splitOrientation: this.value.splitOrientation, zoom: this.value.zoom};
  }
}

export function designerControlName(type, existingNames, {naming = 'type'} = {}) {
  if (naming === 'none') return '';
  const name = type.split('.').at(-1);
  const prefix = naming === 'camelCase' ? name[0].toLowerCase() + name.slice(1) : name;
  const existing = new Set(existingNames);
  let serial = 1;
  while (existing.has(prefix + serial)) serial++;
  return prefix + serial;
}
