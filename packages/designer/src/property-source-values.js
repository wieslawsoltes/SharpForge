import {MEDIA, canonicalType} from '@sharpforge/framework';
import {authoringError, boundedArray, finiteNumber} from './property-diagnostics.js';
import {normalizeDesignerBrush, normalizeDesignerColor} from './property-values.js';

/** Decode a closed authored value syntax record. The caller supplies its bounded constant reader. */
export function readExtendedDesignerSourceValue(node, read) {
  if (node?.kind !== 'New') return {handled: false};
  const type = canonicalType(node.type);
  if (type === 'Windows.Foundation.Point') {
    if (node.initializers?.length || node.collectionInitializers?.length) {
      authoringError('SFD1813', 'Gradient points require a closed coordinate constructor.');
    }
    const args = node.args.map(read);
    if (args.length !== 2) authoringError('SFD1813', 'A gradient point requires two constant coordinates.');
    return {handled: true, value: {X: finiteNumber(args[0]), Y: finiteNumber(args[1])}};
  }
  if (type === MEDIA + 'GradientStopCollection') {
    if (node.args.length || node.initializers?.length) authoringError('SFD1813', 'Gradient collections require a closed item initializer.');
    const entries = boundedArray(node.collectionInitializers ?? [], 64, 'Gradient stops');
    return {handled: true, value: entries.map(entry => {
      if (entry.length !== 1) authoringError('SFD1813', 'Each gradient collection entry requires one stop.');
      return read(entry[0]);
    })};
  }
  if (![MEDIA + 'GradientStop', MEDIA + 'LinearGradientBrush'].includes(type)) return {handled: false};
  if (node.args.length) authoringError('SFD1813', 'Authored gradient constructors are parameterless.');
  if (node.collectionInitializers?.length) authoringError('SFD1813', 'Gradient values require named property initializers.');
  const allowed = new Set(type === MEDIA + 'GradientStop' ? ['Color', 'Offset'] : ['StartPoint', 'EndPoint', 'Opacity', 'GradientStops']);
  const values = {};
  for (const initializer of node.initializers ?? []) {
    if (!allowed.has(initializer.name) || Object.hasOwn(values, initializer.name)) {
      authoringError('SFD1813', 'Unsupported or repeated gradient property: ' + initializer.name);
    }
    if (initializer.name === 'GradientStops') {
      values.GradientStops = initializer.expression.kind === 'DesignCollection'
        ? boundedArray(initializer.expression.items, 64, 'Gradient stops').map(read)
        : boundedArray(read(initializer.expression), 64, 'Gradient stops');
    } else values[initializer.name] = read(initializer.expression);
  }
  if (type === MEDIA + 'GradientStop') return {handled: true, value: {
    Color: normalizeDesignerColor(values.Color ?? '#00000000'),
    Offset: finiteNumber(values.Offset ?? 0, {minimum: 0, maximum: 1, label: 'Stop offset'})
  }};
  return {handled: true, value: normalizeDesignerBrush({valueType: type, ...values})};
}
