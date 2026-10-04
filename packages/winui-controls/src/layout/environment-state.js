const rectangle = Object.freeze({ X: 0, Y: 0, Width: 0, Height: 0 });
const dimensions = Object.freeze({ Width: 0, Height: 0 });
export const environmentSystemColorNames = Object.freeze(['Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ActiveText',
  'ButtonFace', 'ButtonText', 'ButtonBorder', 'Field', 'FieldText', 'Highlight', 'HighlightText', 'GrayText', 'Mark', 'MarkText']);
const defaults = Object.freeze({ RootId: null, ContentId: null, RasterizationScale: 1, Size: dimensions,
  IsHostVisible: true, TextScaleFactor: 1, HighContrast: false, HighContrastScheme: '',
  AnimationsEnabled: true, TouchMode: false, DarkTheme: true, InputPaneOccludedRect: rectangle, SystemColors: Object.freeze({}) });
const booleanFields = new Set(['IsHostVisible', 'HighContrast', 'AnimationsEnabled', 'TouchMode', 'DarkTheme']);

function finite(value, minimum, maximum, name) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError('SFUI1670: Invalid environment ' + name);
  return value;
}
function record(value, names, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SFUI1670: Invalid environment ' + name);
  const result = {};
  for (const field of names) result[field] = finite(value[field], ['Width', 'Height'].includes(field) ? 0 : -1e7, 1e7, name);
  return Object.freeze(result);
}
function identifier(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value || value.length > 512) throw new TypeError('SFUI1670: Invalid environment identity');
  return value;
}
function fieldValue(name, value) {
  if (name === 'SystemColors') return colorPalette(value);
  if (booleanFields.has(name)) {
    if (typeof value !== 'boolean') throw new TypeError('SFUI1670: Environment flags must be boolean');
    return value;
  }
  if (name === 'RootId' || name === 'ContentId') return identifier(value);
  if (name === 'RasterizationScale') return finite(value, 0.0625, 16, name);
  if (name === 'TextScaleFactor') return finite(value, 0.5, 8, name);
  if (name === 'Size') return record(value, ['Width', 'Height'], name);
  if (name === 'InputPaneOccludedRect') return record(value, ['X', 'Y', 'Width', 'Height'], name);
  if (typeof value !== 'string' || value.length > 256) throw new TypeError('SFUI1670: Invalid high contrast scheme');
  return value;
}
function colorPalette(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SFUI1670: Invalid system color palette');
  const result = {};
  for (const [name, color] of Object.entries(value)) {
    if (!environmentSystemColorNames.includes(name) || typeof color !== 'string' || color.length > 128
      || !/^(?:#[\da-f]{6}(?:[\da-f]{2})?|rgba?\([\d\s.,/%+-]+\))$/i.test(color)) {
      throw new TypeError('SFUI1670: Invalid resolved system color');
    }
    result[name] = color;
  }
  return Object.freeze(result);
}
const equal = (left, right) => left === right || left && right && typeof left === 'object'
  && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => left[key] === right[key]);

/** Clone-only environment protocol. Dimensions use host DIPs; raster and text scale are independent. */
export function validateEnvironmentSnapshot(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError('SFUI1670: Invalid environment snapshot');
  }
  if (Object.keys(value).some(key => key !== 'version' && key !== 'revision' && !Object.hasOwn(defaults, key))) {
    throw new TypeError('SFUI1670: Unknown environment snapshot field');
  }
  const result = { version: 1, revision: value.revision };
  for (const [name, fallback] of Object.entries(defaults)) result[name] = fieldValue(name, value[name] ?? fallback);
  return Object.freeze(result);
}

/** One explicit environment per host/session; the same model works without a DOM in source and CIL VMs. */
export class EnvironmentState {
  constructor(initial = {}) {
    this.value = validateEnvironmentSnapshot({ ...defaults, ...initial, version: 1, revision: initial.revision ?? 0 });
    this.listeners = new Set();
    this.disposed = false;
  }
  get revision() { return this.value.revision; }
  get RootId() { return this.value.RootId; }
  get ContentId() { return this.value.ContentId; }
  get RasterizationScale() { return this.value.RasterizationScale; }
  get Size() { return this.value.Size; }
  get IsHostVisible() { return this.value.IsHostVisible; }
  get TextScaleFactor() { return this.value.TextScaleFactor; }
  get HighContrast() { return this.value.HighContrast; }
  get HighContrastScheme() { return this.value.HighContrastScheme; }
  get AnimationsEnabled() { return this.value.AnimationsEnabled; }
  get TouchMode() { return this.value.TouchMode; }
  get DarkTheme() { return this.value.DarkTheme; }
  get InputPaneOccludedRect() { return this.value.InputPaneOccludedRect; }
  get SystemColors() { return this.value.SystemColors; }
  snapshot() { return { ...this.value, Size: { ...this.Size }, InputPaneOccludedRect: { ...this.InputPaneOccludedRect },
    SystemColors: { ...this.SystemColors } }; }
  subscribe(callback) {
    if (this.disposed) throw new Error('SFUI1671: Environment has been disposed');
    if (typeof callback !== 'function') throw new TypeError('Environment subscription requires a callback');
    if (this.listeners.size >= 20000) throw new RangeError('SFUI1670: Environment subscription limit');
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  update(changes) { return this.updateFeedback({ ...this.value, ...changes, revision: this.revision + 1 }); }
  updateFeedback(snapshot) {
    if (this.disposed) throw new Error('SFUI1671: Environment has been disposed');
    const next = validateEnvironmentSnapshot(snapshot);
    const changed = Object.keys(defaults).filter(name => !equal(this.value[name], next[name]));
    if (!changed.length) return false;
    const previous = this.value;
    this.value = Object.freeze({ ...next, revision: Math.max(this.revision + 1, next.revision) });
    const event = { changed: Object.freeze(changed), previous, current: this.value };
    if (changed.includes('InputPaneOccludedRect')) event.inputPane = {
      OccludedRect: { valueType: 'Windows.Foundation.Rect', ...this.InputPaneOccludedRect }, EnsuredFocusedElementInView: false };
    for (const callback of [...this.listeners]) callback(event);
    return true;
  }
  restore(snapshot) { this.value = validateEnvironmentSnapshot(snapshot); }
  dispose() { this.disposed = true; this.listeners.clear(); }
}

const touchTypes = new Set(['Button', 'HyperlinkButton', 'ToggleButton', 'RepeatButton', 'DropDownButton', 'SplitButton',
  'ToggleSplitButton', 'AppBarButton', 'AppBarToggleButton', 'CheckBox', 'RadioButton', 'ToggleSwitch', 'TextBox', 'PasswordBox',
  'RichEditBox', 'AutoSuggestBox', 'NumberBox', 'ComboBox', 'Slider', 'RatingControl', 'CalendarDatePicker', 'DatePicker', 'TimePicker',
  'ListViewItem', 'GridViewItem', 'SelectorBarItem', 'NavigationViewItem', 'TreeViewItem', 'MenuFlyoutItem', 'MenuFlyoutToggleItem']);

/** Touch policy changes effective constraints, never the element's managed dependency-property value. */
export function environmentLayoutProperties(node, environment) {
  const properties = node.properties ?? {};
  const type = node.frameworkType ?? node.type;
  if (!environment?.TouchMode || !touchTypes.has(type.slice(type.lastIndexOf('.') + 1))) return properties;
  return { ...properties, MinWidth: Math.max(40, properties.MinWidth || 0), MinHeight: Math.max(40, properties.MinHeight || 0) };
}
