import {canonicalType, frameworkType, enumValue, colorValues, XAML, CONTROLS, MEDIA} from '@sharpforge/framework';
import {sourcePath} from './source-text.js';
import {failSource} from './source-errors.js';
import {readExtendedDesignerSourceValue} from './property-source-values.js';

function decodeColor(hex) {
  const value = hex.length === 7 ? 'ff' + hex.slice(1) : hex.slice(1);
  const channels = ['A', 'R', 'G', 'B'].map((key, index) => [key, parseInt(value.slice(index * 2, index * 2 + 2), 16)]);
  return {valueType: 'Windows.UI.Color', ...Object.fromEntries(channels)};
}

const binary = Object.freeze({
  '+': (left, right) => left + right,
  '-': (left, right) => left - right,
  '*': (left, right) => left * right,
  '/': (left, right) => left / right,
  '%': (left, right) => left % right
});

/** Resolves a Style target from its closed string or typeof syntax without evaluating user code. */
export function readSourceStyleType(node, state) {
  if (node.kind !== 'TypeOfExpression') return canonicalType(readSourceValue(node, state));
  const syntax = state.context.chosen.parsed.syntax.findNode(node.start, node.end);
  if (syntax.kind !== 'TypeOfExpression') failSource('Style target type has no matching syntax', node, 'SFSYNC_OWNERSHIP');
  const symbol = state.context.model.getTypeInfo(syntax.type).type;
  return canonicalType(symbol?.legacy?.fullName ?? (symbol ? state.context.model.symbols.nameOf(symbol) : syntax.type.toString()));
}

/** Closed constants and registered value constructors; an optional scoped constant resolver takes precedence over legacy decoding. */
export function readSourceValue(node, state, depth = 0) {
  if (!node || depth > 100) failSource('Constant expression depth limit exceeded', node, 'SFSYNC_LIMIT');
  const constant = state.constantValue?.(node);
  if (constant?.hasValue) return constant.value;
  const read = child => readSourceValue(child, state, depth + 1);
  if (node.kind === 'Literal') return node.value;
  if (node.kind === 'Unary' && ['-', '+', '!', '~'].includes(node.operator)) {
    const value = read(node.operand);
    if (node.operator === '-') return -value;
    if (node.operator === '+') return +value;
    if (node.operator === '!') return !value;
    return ~value;
  }
  if (['Checked', 'Unchecked', 'Cast'].includes(node.kind)) return read(node.expression);
  if (node.kind === 'Binary' && binary[node.operator]) return binary[node.operator](read(node.left), read(node.right));
  const existing = state.lookup(node);
  if (existing !== undefined) return existing;
  const enumeration = enumValue(sourcePath(node));
  if (enumeration) return enumeration.value;
  if (node.kind === 'Member') return memberValue(node, state);
  if (node.kind === 'New') return constructedValue(node, read);
  if (node.kind === 'Call' && ['Color.FromArgb', 'Windows.UI.Color.FromArgb'].includes(sourcePath(node.target))) {
    const values = node.args.map(read);
    return {valueType: 'Windows.UI.Color', ...Object.fromEntries(['A', 'R', 'G', 'B'].map((key, index) => [key, values[index]]))};
  }
  failSource('Dynamic expression is preserved in C# and is not evaluated by the designer', node, 'SFSYNC_DYNAMIC');
}

function memberValue(node, state) {
  const target = sourcePath(node.target);
  if (['Colors', 'Microsoft.UI.Colors'].includes(target) && colorValues[node.name]) return decodeColor(colorValues[node.name]);
  if (frameworkType(target)?.name === XAML + 'GridLength' && node.name === 'Auto') {
    return {valueType: XAML + 'GridLength', Value: 0, GridUnitType: 0};
  }
  if (node.name.endsWith('Property') && frameworkType(target)) {
    return {dependencyProperty: node.name.slice(0, -8), owner: canonicalType(target)};
  }
  const value = state.context.model.getConstantValue(node);
  if (value.hasValue) return value.value;
  failSource('Dynamic expression is preserved in C# and is not evaluated by the designer', node, 'SFSYNC_DYNAMIC');
}

function constructedValue(node, read) {
  const extended = readExtendedDesignerSourceValue(node, read);
  if (extended.handled) return extended.value;
  const type = canonicalType(node.type);
  const args = node.args.map(read);
  let value;
  if ([XAML + 'Thickness', XAML + 'CornerRadius'].includes(type)) {
    const keys = type.endsWith('Thickness') ? ['Left', 'Top', 'Right', 'Bottom'] : ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
    if (args.length !== 1 && args.length !== 4) failSource('Unsupported value constructor', node, 'SFSYNC_DYNAMIC');
    value = {valueType: type, ...Object.fromEntries(keys.map((key, index) => [key, args.length === 1 ? args[0] : args[index]]))};
  } else if (type === XAML + 'GridLength') {
    value = {valueType: type, Value: args[0], GridUnitType: args[1] ?? 1};
  } else if (type === MEDIA + 'SolidColorBrush') {
    value = {valueType: type, Color: args[0] ?? decodeColor('#00000000')};
  } else if (type === XAML + 'Setter') {
    if (!args[0]?.dependencyProperty) failSource('A static dependency-property identifier is required', node, 'SFSYNC_DYNAMIC');
    value = {setter: args[0].dependencyProperty, value: args[1], targetType: args[0].owner};
  } else if ([CONTROLS + 'RowDefinition', CONTROLS + 'ColumnDefinition'].includes(type)) {
    value = {definition: type};
  } else {
    failSource('Expression is not a supported constant value', node, 'SFSYNC_DYNAMIC');
  }
  for (const initializer of node.initializers ?? []) value[initializer.name] = read(initializer.expression);
  return value;
}
