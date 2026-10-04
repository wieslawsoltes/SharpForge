import { ControlError } from '../policy/events.js';
import { XAML as X, TEXT as T, registerMethod, registerGet } from '../policy/adapter-helpers.js';

export const fontWeights = Object.freeze({ Thin: 100, ExtraLight: 200, Light: 300, SemiLight: 350, Normal: 400,
  Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900, ExtraBlack: 950 });

export const fontFallbacks = Object.freeze({ text: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  icons: '"Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif' });

const capitals = [[], ['c2sc', 'smcp'], ['smcp'], ['c2pc', 'pcap'], ['pcap'], ['unic'], ['titl']];
const numerals = [[], ['lnum'], ['onum']];
const numeralAlignment = [[], ['pnum'], ['tnum']];

export function typographyFeatures(properties) {
  const features = [];
  for (const [property, choices] of [['Capitals', capitals], ['NumeralStyle', numerals], ['NumeralAlignment', numeralAlignment]]) {
    const value = properties['Typography.' + property] ?? 0;
    if (!Number.isInteger(value) || !choices[value]) throw new ControlError('SFUI1641', 'Unknown typography feature value', { property, value });
    for (const tag of choices[value]) features.push(`"${tag}" 1`);
  }
  return features;
}

export function fontFamilySource(value) {
  const source = typeof value === 'string' ? value : value?.Source;
  if (source == null || source === '' || source === 'Segoe UI' || source === 'Segoe UI Variable') return fontFallbacks.text;
  if (source === 'Segoe Fluent Icons' || source === 'Segoe MDL2 Assets') return fontFallbacks.icons;
  if (typeof source !== 'string' || source.length > 1024 || /[\u0000-\u001f{};]|url\s*\(/i.test(source)) {
    throw new ControlError('SFUI1641', 'Invalid font-family name');
  }
  return source;
}

export function registerTypographyContracts(b) {
  const { X, C } = b;
  const media = X + 'Media.';
  b.type(media + 'FontFamily', 'object', 'object', [['string']]);
  b.property(media + 'FontFamily', 'Source', 'string', '', true);
  b.property(media + 'FontFamily', 'XamlAutoFontFamily', media + 'FontFamily', null, true, true);
  b.type('Windows.UI.Text.FontWeight', 'System.ValueType', 'value');
  b.property('Windows.UI.Text.FontWeight', 'Weight', 'ushort', 400);
  b.enumeration('Windows.UI.Text.FontStyle', { Normal: 0, Oblique: 1, Italic: 2 });
  b.type(T + 'FontWeights', 'object', 'static', []);
  for (const name of Object.keys(fontWeights)) b.property(T + 'FontWeights', name, 'Windows.UI.Text.FontWeight', null, true, true);
  b.enumeration(X + 'FontCapitals', { Normal: 0, AllSmallCaps: 1, SmallCaps: 2, AllPetiteCaps: 3, PetiteCaps: 4, Unicase: 5, Titling: 6 });
  b.enumeration(X + 'FontNumeralStyle', { Normal: 0, Lining: 1, OldStyle: 2 });
  b.enumeration(X + 'FontNumeralAlignment', { Normal: 0, Proportional: 1, Tabular: 2 });
  for (const property of ['Capitals', 'NumeralStyle', 'NumeralAlignment']) {
    const type = X + 'Font' + property;
    b.method(X + 'Documents.Typography', 'Set' + property, [X + 'DependencyObject', type], 'void',
      { kind: 'attachedSet', isStatic: true, property: 'Typography.' + property });
    b.method(X + 'Documents.Typography', 'Get' + property, [X + 'DependencyObject'], type,
      { kind: 'attachedGet', isStatic: true, property: 'Typography.' + property });
  }
  for (const owner of [C + 'Control', C + 'TextBlock', C + 'RichTextBlock', X + 'Documents.TextElement']) {
    b.property(owner, 'FontFamilyObject', media + 'FontFamily');
    b.property(owner, 'FontWeight', 'Windows.UI.Text.FontWeight');
    b.property(owner, 'FontStyle', 'Windows.UI.Text.FontStyle', 0);
  }
}

export function registerTypographyAdapters(registry) {
  for (const [name, values] of [['Bold', { FontWeight: { valueType: 'Windows.UI.Text.FontWeight', Weight: 700 } }],
    ['Italic', { FontStyle: 2 }]]) {
    registerMethod(registry, X + 'Documents.' + name, '.ctor', context => {
      const owner = context.allocate(X + 'Documents.' + name);
      context.services.defaultStyleValues(owner, values);
      return owner;
    }, { kind: 'constructor' });
  }
  registerMethod(registry, X + 'Media.FontFamily', '.ctor', (context, receiver, args) => {
    const source = String(context.native(args[0]));
    fontFamilySource(source);
    return context.allocate(X + 'Media.FontFamily', { Source: source });
  }, { kind: 'constructor' });
  registerGet(registry, X + 'Media.FontFamily', 'XamlAutoFontFamily', context =>
    context.singleton('family.defaultFont', () => context.allocate(X + 'Media.FontFamily', { Source: 'Segoe UI Variable' })));
  for (const [name, weight] of Object.entries(fontWeights)) registerGet(registry, T + 'FontWeights', name,
    context => context.allocate('Windows.UI.Text.FontWeight', { Weight: weight }));
}
