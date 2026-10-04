/**
 * Nullable analysis attributes and the suppression operator (SF-A02-T05.5; System.Diagnostics.CodeAnalysis).
 *
 * The attributes refine what a signature says about null:
 *   preconditions   AllowNull, DisallowNull                       (what a caller may pass / assign)
 *   postconditions  NotNull, MaybeNull, NotNullWhen(bool), MaybeNullWhen(bool), NotNullIfNotNull("p"),
 *                   MemberNotNull("m", ...), MemberNotNullWhen(bool, "m", ...)
 *   reachability    DoesNotReturn, DoesNotReturnIf(bool)
 * `nullableAttributesOf` reads them from a source symbol's attribute syntax (or from imported attribute data) and the
 * helper functions answer the questions the flow walker asks. `x!` (the null-forgiving operator) simply makes the
 * expression not-null and silences the warnings it would have caused.
 */
import { SymbolKind } from '../symbols/types.js';

const attributeNames = new Set([
  'AllowNull',
  'DisallowNull',
  'NotNull',
  'MaybeNull',
  'NotNullWhen',
  'MaybeNullWhen',
  'NotNullIfNotNull',
  'MemberNotNull',
  'MemberNotNullWhen',
  'DoesNotReturn',
  'DoesNotReturnIf',
]);

const withoutSuffix = name => name.replace(/Attribute$/, '');

function simpleName(nameSyntax) {
  if (nameSyntax.kind === 'QualifiedName') return simpleName(nameSyntax.right);
  if (nameSyntax.kind === 'AliasQualifiedName') return simpleName(nameSyntax.name);
  return nameSyntax.identifier?.valueText ?? '';
}

/** The literal value of an attribute argument: true/false, a string, or `nameof(x)`; undefined otherwise. */
function argumentValue(expression) {
  switch (expression.kind) {
    case 'TrueLiteralExpression':
      return true;
    case 'FalseLiteralExpression':
      return false;
    case 'StringLiteralExpression':
      return expression.token.value;
    case 'InvocationExpression': {
      const isNameOf = expression.expression.kind === 'IdentifierName' && expression.expression.identifier.valueText === 'nameof';
      const operand = expression.argumentList.arguments[0]?.expression;
      if (!isNameOf || !operand) return undefined;
      return operand.kind === 'SimpleMemberAccessExpression' ? operand.name.identifier.valueText : operand.identifier?.valueText;
    }
    default:
      return undefined;
  }
}

function fromSyntax(attributeLists, wantReturnTarget) {
  const found = [];
  for (const list of attributeLists ?? []) {
    const target = list.target?.identifier?.valueText ?? null;
    if ((target === 'return') !== wantReturnTarget) continue;
    for (const attribute of list.attributes) {
      const name = withoutSuffix(simpleName(attribute.name));
      if (!attributeNames.has(name)) continue;
      const values = (attribute.argumentList?.arguments ?? []).map(argument => argumentValue(argument.expression));
      found.push({ name, arguments: values });
    }
  }
  return found;
}

function fromMetadata(attributes) {
  const found = [];
  for (const attribute of attributes ?? []) {
    const name = withoutSuffix(attribute.name ?? attribute.attributeClass?.name ?? '');
    if (attributeNames.has(name)) found.push({ name, arguments: attribute.arguments ?? attribute.constructorArguments ?? [] });
  }
  return found;
}

/**
 * The nullable-analysis attributes of a parameter, method, property or field.
 * @param symbol the symbol (source symbols carry `syntax`, imported ones `attributes`)
 * @param {{ returnValue?: boolean }} [options] read `[return: ...]` attributes of a method instead
 * @returns {{ name: string, arguments: any[] }[]}
 */
export function nullableAttributesOf(symbol, { returnValue = false } = {}) {
  if (!symbol) return [];
  const cacheKey = returnValue ? '_nullableReturnAttributes' : '_nullableAttributes';
  if (symbol[cacheKey]) return symbol[cacheKey];
  const syntax = symbol.declarationSyntax ?? symbol.syntax;
  const lists = syntax?.attributeLists ?? syntax?.parent?.parent?.attributeLists;
  const result = lists ? fromSyntax(lists, returnValue) : fromMetadata(returnValue ? symbol.returnAttributes : symbol.attributes);
  symbol[cacheKey] = result;
  return result;
}

const has = (attributes, name) => attributes.some(attribute => attribute.name === name);
const find = (attributes, name) => attributes.find(attribute => attribute.name === name) ?? null;

/** [AllowNull]: null may be passed or assigned although the type is not annotated. */
export const allowsNull = symbol => has(nullableAttributesOf(symbol), 'AllowNull');
/** [DisallowNull]: null may not be passed or assigned although the type is annotated. */
export const disallowsNull = symbol => has(nullableAttributesOf(symbol), 'DisallowNull');
/** [DoesNotReturn]: a call to the method never completes normally. */
export const doesNotReturn = method => has(nullableAttributesOf(method), 'DoesNotReturn');

/** [DoesNotReturnIf(b)] on a bool parameter: the call does not return when the argument equals `b`; null when absent. */
export function doesNotReturnIf(parameter) {
  const attribute = find(nullableAttributesOf(parameter), 'DoesNotReturnIf');
  return attribute ? attribute.arguments[0] === true : null;
}

/**
 * What a by-value read of a member or method result is, after attributes: 'notNull', 'maybeNull' or null (the
 * declared annotation decides).
 */
export function resultState(symbol, { returnValue = false } = {}) {
  const attributes = nullableAttributesOf(symbol, { returnValue });
  if (has(attributes, 'NotNull')) return 'notNull';
  if (has(attributes, 'MaybeNull')) return 'maybeNull';
  return null;
}

/**
 * The state of an argument variable after a call, per the parameter's postcondition attributes.
 * @param parameter the parameter symbol
 * @param {boolean|null} returned the bool the method returned on this path, or null when unknown or not bool
 * @returns {'notNull'|'maybeNull'|null} null when the attributes say nothing for this path
 */
export function argumentStateAfterCall(parameter, returned) {
  const attributes = nullableAttributesOf(parameter);
  if (has(attributes, 'NotNull')) return 'notNull';
  if (has(attributes, 'MaybeNull')) return 'maybeNull';
  const notNullWhen = find(attributes, 'NotNullWhen');
  if (notNullWhen && returned !== null && notNullWhen.arguments[0] === returned) return 'notNull';
  const maybeNullWhen = find(attributes, 'MaybeNullWhen');
  // Without a known result the worst case applies: the argument may be null.
  if (maybeNullWhen) return returned === null || maybeNullWhen.arguments[0] === returned ? 'maybeNull' : 'notNull';
  return null;
}

/** [return: NotNullIfNotNull("p")]: the names of the parameters whose non-null argument makes the result non-null. */
export function notNullIfNotNullParameters(method) {
  return nullableAttributesOf(method, { returnValue: true })
    .filter(attribute => attribute.name === 'NotNullIfNotNull')
    .map(attribute => attribute.arguments[0])
    .filter(name => typeof name === 'string');
}

/**
 * [MemberNotNull("a", "b")] and [MemberNotNullWhen(true, "a")]: the members a call guarantees to be non-null.
 * @param {boolean|null} returned the bool result on this path (for the `When` form)
 * @returns {string[]} member names
 */
export function membersNotNullAfterCall(method, returned) {
  const names = [];
  // On a property the attributes may sit on the property or on its get accessor.
  const getter = method.kind === SymbolKind.Property ? method.getMethod : null,
    attributes = getter ? [...nullableAttributesOf(method), ...nullableAttributesOf(getter)] : nullableAttributesOf(method);
  for (const attribute of attributes) {
    if (attribute.name === 'MemberNotNull') names.push(...attribute.arguments.filter(value => typeof value === 'string'));
    if (attribute.name === 'MemberNotNullWhen' && returned !== null && attribute.arguments[0] === returned) {
      names.push(...attribute.arguments.slice(1).filter(value => typeof value === 'string'));
    }
  }
  return names;
}

/** True when a parameter carries an attribute that makes its null-state depend on the bool result. */
export function hasConditionalPostcondition(parameter) {
  const attributes = nullableAttributesOf(parameter);
  return has(attributes, 'NotNullWhen') || has(attributes, 'MaybeNullWhen');
}
