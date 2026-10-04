import {findContracts} from '@sharpforge/framework';
import {isNullableType} from '../../conversions/nullable.js';
import {n} from './node-factory.js';
import {uiNumericConvert} from './ui-numeric-values.js';

const approved = new Set(['int', 'uint', 'float', 'double', 'bool', 'System.DateTimeOffset', 'System.TimeSpan']);

/** The image stores approved UI Nullable<T> as a T box or null; the CLI boundary emits real Nullable<T> values. */
export function uiNullableType(generator, type) {
  if (!isNullableType(type)) return null;
  const underlying = type.nullableUnderlyingType;
  const name = generator.bridge.registryName(underlying);
  return approved.has(name) ? {name, underlying} : null;
}

const present = value => n.notEquals(value, n.nullLiteral('object'));
const box = (translator, value, name) => translator.g.ui.intrinsic('Box', [value, n.literal(name, 'string')], 'object');

function rawValue(translator, value, type, guard) {
  const result = translator.uiResult(translator.g.ui.cast(value, type.underlying), translator.imageType(type.underlying));
  return guard ? n.sequence([], [translator.g.ui.intrinsic('RequireNullableValue', [value], 'void')], result) : result;
}

/** Getter values are captured before null tests, preserving once-only evaluation and boxing at the CLI store. */
export function uiNullableRead(translator, value, type) {
  const temp = translator.temp('object', 'nullable');
  return n.sequence([temp], [n.assign(n.local(temp), value)],
    n.conditional(present(n.local(temp)), box(translator, n.local(temp), type.name), n.nullLiteral('object'), 'object'));
}

export function uiNullableProperty(translator, node) {
  const type = uiNullableType(translator.g, node.receiver?.type);
  if (!type) return null;
  const value = translator.once(translator.expression(node.receiver), 'nullable');
  if (node.property.name === 'HasValue') return n.sequence(value.locals, value.effects, present(value.read()));
  if (node.property.name === 'Value') return n.sequence(value.locals, value.effects, rawValue(translator, value.read(), type, true));
  return null;
}

function defaultValue(translator, type) {
  if (type.name === 'System.TimeSpan') {
    const contract = findContracts(type.name, 'get_Zero', true)[0];
    return n.frameworkCall({contract}, null, [], type.name);
  }
  if (type.name === 'System.DateTimeOffset') {
    const contract = findContracts(type.name, '.ctor', false).find(value => value.parameters.length === 0);
    return n.frameworkCall({contract}, null, [], type.name);
  }
  return translator.defaultValue(type.name);
}

export function uiNullableCall(translator, node) {
  const type = uiNullableType(translator.g, node.receiver?.type);
  const args = node.args ?? [];
  if (!type || node.method.name !== 'GetValueOrDefault' && !(node.method.name === 'ToString' && args.length === 0)) return null;
  const value = translator.once(translator.expression(node.receiver), 'nullable');
  if (node.method.name === 'ToString' && args.length === 0) {
    const contract = findContracts('System.Convert', 'ToString', true)
      .find(member => member.parameters.length === 1 && member.parameters[0] === 'object');
    return n.sequence(value.locals, value.effects, n.conditional(present(value.read()),
      n.frameworkCall({contract}, null, [value.read()], 'string'), n.literal('', 'string'), 'string'));
  }
  // Even when a value is present, an explicit default argument has C#'s normal eager argument evaluation.
  const fallback = translator.once(args.length ? translator.expression(args[0].expression) : defaultValue(translator, type), 'default');
  return n.sequence([...value.locals, ...fallback.locals], [...value.effects, ...fallback.effects],
    n.conditional(present(value.read()), rawValue(translator, value.read(), type, false), fallback.read(), translator.imageType(type.underlying)));
}

export function uiNullableConversion(translator, node) {
  const source = uiNullableType(translator.g, node.operand?.type), target = uiNullableType(translator.g, node.type);
  const kind = node.conversion?.kind;
  if (!source && !target) return null;
  if (kind === 'Identity' || kind === 'Boxing' || source && target && source.name === target.name) return translator.expression(node.operand);
  if (kind === 'NullLiteral' || kind === 'DefaultLiteral') return n.nullLiteral('object');
  if (['ImplicitNullable', 'ExplicitNullable'].includes(kind)) {
    const captured = translator.once(translator.expression(node.operand), 'nullable');
    const raw = source ? rawValue(translator, captured.read(), source, !target) : captured.read();
    const destination = target?.name ?? translator.imageType(node.type, node.syntax);
    const converted = raw.legacyType === destination ? raw : numericConversion(translator, raw, destination, node);
    const value = target ? box(translator, converted, target.name) : converted;
    return n.sequence(captured.locals, captured.effects, source && target
      ? n.conditional(present(captured.read()), value, n.nullLiteral('object'), 'object') : value);
  }
  if (kind === 'Unboxing' && target) {
    const captured = translator.once(translator.expression(node.operand), 'nullable');
    const checked = n.sequence([], [rawValue(translator, captured.read(), target, false)], captured.read());
    return n.sequence(captured.locals, captured.effects, n.conditional(present(captured.read()), checked, n.nullLiteral('object'), 'object'));
  }
  return null;
}

export function uiNullableCreation(translator, node) {
  const type = uiNullableType(translator.g, node.type);
  if (!type) return null;
  const args = node.args ?? [];
  if (args.length > 1 || node.initializers?.length || node.collectionInitializers?.length) {
    return translator.unsupported('this nullable construction', node.syntax);
  }
  return args.length ? box(translator, translator.expression(args[0].expression), type.name) : n.nullLiteral('object');
}

function numericConversion(translator, value, destination, node) {
  if (['float', 'uint'].includes(value.legacyType) || ['float', 'uint'].includes(destination)) {
    return uiNumericConvert(translator, value, destination, node);
  }
  if (['int', 'double'].includes(value.legacyType) && ['int', 'double'].includes(destination)) {
    return n.convert(value, destination, !!node.isChecked);
  }
  return translator.unsupported('this nullable underlying conversion', node.syntax);
}

export function uiNullableBinary(translator, node) {
  if (!node.isLifted || !['==', '!='].includes(node.operator)) return null;
  const left = uiNullableType(translator.g, node.left?.type), right = uiNullableType(translator.g, node.right?.type);
  if (!left && !right) return null;
  if (isNullOperand(node.left) || isNullOperand(node.right)) {
    return n.binary(node.operator, translator.expression(node.left), translator.expression(node.right), 'bool');
  }
  return null;
}

function isNullOperand(node) {
  return !!node.constantValue?.isNull || node.literal === 'null' ||
    node.kind === 'Conversion' && node.conversion?.kind === 'NullLiteral';
}

export function uiNullableCoalesce(translator, node) {
  const type = uiNullableType(translator.g, node.left?.type);
  if (!type || isNullableType(node.type)) return null;
  const captured = translator.once(translator.expression(node.left), 'nullable');
  const resultType = translator.imageType(node.type, node.syntax);
  const raw = rawValue(translator, captured.read(), type, false);
  const converted = raw.legacyType === resultType ? raw : numericConversion(translator, raw, resultType, node);
  return n.sequence(captured.locals, captured.effects,
    n.conditional(present(captured.read()), converted, translator.expression(node.right), resultType));
}
