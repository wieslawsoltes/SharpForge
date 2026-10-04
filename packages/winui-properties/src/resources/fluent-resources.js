import {ResourceDictionary} from './resource-dictionary.js';
import {fluentLightDefinitions} from './fluent-light.js';
import {fluentDarkDefinitions} from './fluent-dark.js';
import {fluentHighContrastDefinitions} from './fluent-high-contrast.js';
import {createAccentRamp, xamlColorToCss} from './accent-color.js';
import {ResourceFault} from './errors.js';
import {themeResource} from './reference.js';

export const systemColors = Object.freeze({
  SystemColorWindowColor: 'Canvas',
  SystemColorWindowTextColor: 'CanvasText',
  SystemColorButtonFaceColor: 'ButtonFace',
  SystemColorButtonTextColor: 'ButtonText',
  SystemColorHighlightColor: 'Highlight',
  SystemColorHighlightTextColor: 'HighlightText',
  SystemColorHotlightColor: 'LinkText',
  SystemColorGrayTextColor: 'GrayText'
});

const metrics = Object.freeze({
  ControlCornerRadius: Object.freeze({topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4}),
  OverlayCornerRadius: Object.freeze({topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8}),
  ControlBorderThemeThickness: Object.freeze({left: 1, top: 1, right: 1, bottom: 1}),
  FocusVisualPrimaryThickness: Object.freeze({left: 2, top: 2, right: 2, bottom: 2}),
  FocusVisualSecondaryThickness: Object.freeze({left: 1, top: 1, right: 1, bottom: 1}),
  ContentControlThemeFontFamily: 'Segoe UI Variable, Segoe UI, system-ui, sans-serif',
  SymbolThemeFontFamily: 'Segoe Fluent Icons, Segoe MDL2 Assets',
  ControlContentThemeFontSize: 14,
  CaptionTextBlockFontSize: 12,
  BodyTextBlockFontSize: 14,
  SubtitleTextBlockFontSize: 20,
  TitleTextBlockFontSize: 28,
  TitleLargeTextBlockFontSize: 40,
  DisplayTextBlockFontSize: 68,
  ControlNormalAnimationDuration: '00:00:00.250',
  ControlFastAnimationDuration: '00:00:00.167',
  ControlFastAnimationAfterDuration: '00:00:00.168',
  ControlFasterAnimationDuration: '00:00:00.083',
  ControlFastOutSlowInKeySpline: '0,0,0,1'
});

function resourceKey(value) {
  return /^\{(?:StaticResource|ThemeResource) ([^}]+)\}$/.exec(value)?.[1];
}

function materialize(definitions, ramp, highContrast, palette = {}) {
  const source = new Map(definitions.map(entry => [entry[0], entry]));
  const colors = Object.entries(systemColors).map(([name, keyword]) => [name, palette[keyword] ?? keyword]);
  const entries = new Map([...Object.entries(metrics), ...colors, ...Object.entries(ramp)]);
  const active = new Set();
  const color = value => {
    const key = resourceKey(value);
    if (!key) return palette[value] ?? value;
    const resolved = resolve(key);
    return typeof resolved === 'string' ? resolved : resolved.color;
  };
  const resolve = key => {
    if (entries.has(key)) return entries.get(key);
    if (active.has(key)) throw new ResourceFault('SFRES011', 'Cyclic Fluent resource data.');
    const definition = source.get(key);
    if (!definition) throw new ResourceFault('SFRES013', `Missing Fluent color resource '${key}'.`);
    active.add(key);
    let value;
    if (definition[1] === 'color') {
      const brush = highContrast ? source.get(key + 'Brush') : null;
      value = highContrast ? brush ? color(brush[2]) : palette.CanvasText ?? 'CanvasText' : definition[2];
    } else if (definition[1] === 'brush') {
      value = Object.freeze({kind: 'SolidColorBrush', color: color(definition[2]), opacity: definition[3]});
    } else {
      value = Object.freeze({kind: 'LinearGradientBrush',
        stops: Object.freeze(definition[2].map(stop => Object.freeze({offset: stop[0], color: color(stop[1])}))),
        mappingMode: definition[3].MappingMode ?? 'RelativeToBoundingBox',
        startPoint: definition[3].StartPoint ?? '0,0', endPoint: definition[3].EndPoint ?? '1,1',
        relativeTransform: definition[3].RelativeTransform ? Object.freeze({...definition[3].RelativeTransform}) : null
      });
    }
    entries.set(key, value);
    active.delete(key);
    return value;
  };
  for (const definition of definitions) resolve(definition[0]);
  return new ResourceDictionary(entries);
}

/** Fluent v2 color/brush data is pinned to the inventory manifest; all themes have identical upstream keys. */
export class FluentResources extends ResourceDictionary {
  constructor({accent = '#0078d4', systemRamp = null, systemPalette = {}} = {}) {
    super();
    this.accent = null;
    this.accentListeners = new Set();
    this.systemPalette = {...systemPalette};
    this.setAccent(accent, {systemRamp});
  }

  setAccent(accent, {systemRamp = null} = {}) {
    const ramp = createAccentRamp(accent, {systemRamp});
    const light = materialize(fluentLightDefinitions, ramp, false, this.systemPalette);
    const dark = materialize(fluentDarkDefinitions, ramp, false, this.systemPalette);
    const contrast = materialize(fluentHighContrastDefinitions, ramp, true, this.systemPalette);
    const previous = this.accent;
    this.transaction(() => {
      this.setTheme('Light', light);
      this.setTheme('Dark', dark);
      this.setTheme('Default', light);
      this.setTheme('HighContrast', contrast);
    });
    this.accent = accent.toLowerCase();
    this.systemRamp = systemRamp;
    if (previous !== this.accent) {
      for (const listener of [...this.accentListeners]) listener({oldColor: previous, newColor: this.accent, ramp});
    }
  }

  /** Resolve system brushes from an explicit host snapshot; workers never guess an operating-system palette. */
  setSystemPalette(palette) {
    const names = Object.keys(palette);
    if (names.length === Object.keys(this.systemPalette).length && names.every(name => palette[name] === this.systemPalette[name])) return;
    this.systemPalette = {...palette};
    this.setAccent(this.accent, {systemRamp: this.systemRamp});
  }

  onAccentChanged(listener) {
    this.accentListeners.add(listener);
    return () => this.accentListeners.delete(listener);
  }

  snapshot() { return {...super.snapshot(), accent: this.accent, accentListeners: [...this.accentListeners],
    systemPalette: {...this.systemPalette}, systemRamp: this.systemRamp}; }
  restore(snapshot) {
    super.restore(snapshot);
    this.accent = snapshot.accent;
    this.systemPalette = {...snapshot.systemPalette};
    this.systemRamp = snapshot.systemRamp;
    this.accentListeners = new Set(snapshot.accentListeners ?? []);
  }

  dispose() {
    this.accentListeners.clear();
    for (const dictionary of new Set(this.themes.values())) dictionary.dispose();
    super.dispose();
  }
}

const cssResources = Object.freeze({
  '--sf-app-bg': 'SolidBackgroundFillColorBaseBrush',
  '--sf-app-fg': 'TextFillColorPrimaryBrush',
  '--sf-app-muted': 'TextFillColorSecondaryBrush',
  '--sf-app-control': 'ControlFillColorDefaultBrush',
  '--sf-app-border': 'ControlStrokeColorDefaultBrush',
  '--sf-app-accent': 'AccentFillColorDefaultBrush'
});

/** Host integration is opt-in and lifetime-bound; matchMedia is injected for browser/headless equivalence. */
export function connectThemeHost(scope, {element, matchMedia = null} = {}) {
  const disposers = [];
  const refresh = () => {
    element?.setAttribute('data-theme', scope.actualTheme.toLowerCase());
    for (const [property, key] of Object.entries(cssResources)) {
      const found = scope.tryFind(key);
      if (found.found) element?.style?.setProperty(property, xamlColorToCss(found.value.color ?? found.value));
    }
  };
  disposers.push(scope.onThemeChanged(refresh));
  for (const [property, key] of Object.entries(cssResources)) {
    disposers.push(scope.observe(themeResource(key), {allowMissing: true, changed: value => {
      if (value !== undefined) element?.style?.setProperty(property, xamlColorToCss(value.color ?? value));
    }}));
  }
  if (matchMedia) {
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const forced = matchMedia('(forced-colors: active)');
    const changed = () => scope.setSystemTheme(dark.matches ? 'Dark' : 'Light', forced.matches);
    for (const query of [dark, forced]) {
      query.addEventListener('change', changed);
      disposers.push(() => query.removeEventListener('change', changed));
    }
    changed();
  }
  refresh();
  return () => { for (const dispose of disposers) dispose(); };
}
