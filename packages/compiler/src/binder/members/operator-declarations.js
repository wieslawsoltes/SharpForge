/**
 * Declaration rules of user-defined operators and conversions (C# spec 15.10), as Roslyn reports them:
 *
 *   CS0558  an operator must be public and static          CS0590  an operator cannot return void
 *   CS0562  unary operand must be the containing type      CS0563  one binary operand must be the containing type
 *   CS0559  ++/-- operand must be the containing type      CS0448  ++/-- must return the containing type
 *   CS0215  true/false must return bool                    CS0216  ==/!=, </>, <=/>=, true/false come in pairs
 *   CS1534  a binary operator takes two parameters         CS1535  a unary operator takes one parameter
 *   CS0555  conversion from the type to itself             CS0556  conversion must involve the containing type
 *   CS0557  the same conversion declared twice             CS0660/CS0661  == or != without Equals / GetHashCode
 *
 * Each check returns `{ member, code, args }` rows; the caller reports them at the member's location (the operator
 * token, or the target type of a conversion).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind, Accessibility } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { stripNullable } from '../../conversions/nullable.js';

const unaryOnly = new Set(['!', '~', '++', '--', 'true', 'false']);
const unaryOrBinary = new Set(['+', '-']);
const pairs = Object.freeze({ '==': '!=', '!=': '==', '<': '>', '>': '<', '<=': '>=', '>=': '<=', true: 'false', false: 'true' });

const isOperator = member => member.kind === SymbolKind.Method && member.methodKind === MethodKind.UserDefinedOperator;
const isConversion = member => member.kind === SymbolKind.Method && member.methodKind === MethodKind.Conversion;
const typesKnown = method => !method.returnType?.isErrorType?.() && method.parameters.every(p => p.type && !p.type.isErrorType());
const sameParameters = (a, b) => a.parameters.length === b.parameters.length && a.parameters.every((p, i) => p.type.equals(b.parameters[i].type));

/** True when `candidate` is the containing type (or its nullable form, for a struct). */
function isContaining(candidate, type) {
  const plain = stripNullable(candidate);
  return (plain.originalDefinition ?? plain) === (type.originalDefinition ?? type);
}

function checkOperator(method, type, operators) {
  const token = method.operatorToken,
    count = method.parameters.length,
    display = method.toDisplayString();
  if (!unaryOnly.has(token) && !(unaryOrBinary.has(token) && count === 1) && count !== 2) return [{ member: method, code: DiagnosticId.CS1534, args: [token] }];
  if (unaryOnly.has(token) && count !== 1) return [{ member: method, code: DiagnosticId.CS1535, args: [token] }];
  const rows = [],
    operands = method.parameters.map(p => p.type);
  if (method.returnType.specialType === 'System_Void') rows.push({ member: method, code: DiagnosticId.CS0590, args: [] });
  else if (token === '++' || token === '--') {
    if (!isContaining(operands[0], type)) rows.push({ member: method, code: DiagnosticId.CS0559, args: [] });
    else if (!isContaining(method.returnType, type)) rows.push({ member: method, code: DiagnosticId.CS0448, args: [] });
  } else if (count === 1) {
    if (!isContaining(operands[0], type)) rows.push({ member: method, code: DiagnosticId.CS0562, args: [] });
    else if ((token === 'true' || token === 'false') && method.returnType.specialType !== 'System_Boolean')
      rows.push({ member: method, code: DiagnosticId.CS0215, args: [] });
  } else if (!operands.some(operand => isContaining(operand, type))) rows.push({ member: method, code: DiagnosticId.CS0563, args: [] });
  const partner = pairs[token];
  if (partner && !operators.some(other => other.operatorToken === partner && sameParameters(other, method)))
    rows.push({ member: method, code: DiagnosticId.CS0216, args: [display, partner] });
  return rows;
}

function checkConversion(method, type, seen) {
  const from = method.parameters[0]?.type,
    to = method.returnType;
  if (!from || method.parameters.length !== 1) return [];
  const fromSelf = isContaining(from, type),
    toSelf = isContaining(to, type);
  if (fromSelf && toSelf) return [{ member: method, code: DiagnosticId.CS0555, args: [] }];
  if (!fromSelf && !toSelf) return [{ member: method, code: DiagnosticId.CS0556, args: [] }];
  const other = fromSelf ? to : from;
  if (other.typeKind === TypeKind.Dynamic) return [{ member: method, code: DiagnosticId.CS1964, args: [method.toDisplayString()] }];
  if (other.typeKind === TypeKind.Interface) return [{ member: method, code: DiagnosticId.CS0552, args: [method.toDisplayString()] }];
  // `explicit operator checked T` is declared next to `explicit operator T`: only the same form twice is a duplicate.
  const isChecked = other => other.name === 'op_CheckedExplicit',
    duplicate = seen.find(
      earlier => isChecked(earlier) === isChecked(method) && earlier.parameters[0].type.equals(from) && earlier.returnType.equals(to),
    );
  seen.push(method);
  return duplicate ? [{ member: method, code: DiagnosticId.CS0557, args: [type.toDisplayString()] }] : [];
}

/** True when the type overrides the method `name` of System.Object with `parameterCount` parameters. */
function overridesObjectMethod(type, name, parameterCount) {
  return type.getMembers(name).some(m => m.kind === SymbolKind.Method && m.isOverride && m.parameters.length === parameterCount);
}

/**
 * Checks the operators and conversions a class or struct declares.
 * @returns {{member: object, code: string, args: any[]}[]} `member` is the operator, or the type for CS0660/CS0661
 */
export function checkOperatorDeclarations(type) {
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return [];
  const members = type.getMembers(),
    operators = members.filter(isOperator),
    rows = [],
    conversions = [];
  for (const method of members) {
    if (!isOperator(method) && !isConversion(method)) continue;
    if (method.declaredAccessibility !== Accessibility.Public || !method.isStatic) {
      rows.push({ member: method, code: DiagnosticId.CS0558, args: [method.toDisplayString()] });
      // A conversion to or from `dynamic` is reported whatever else is wrong with the declaration.
      if (isConversion(method) && typesKnown(method)) rows.push(...checkConversion(method, type, []).filter(row => row.code === DiagnosticId.CS1964));
      continue;
    }
    if (!typesKnown(method)) continue;
    rows.push(...(isOperator(method) ? checkOperator(method, type, operators) : checkConversion(method, type, conversions)));
  }
  if (operators.some(o => o.operatorToken === '==' || o.operatorToken === '!=')) {
    const display = type.toDisplayString();
    if (!overridesObjectMethod(type, 'Equals', 1)) rows.push({ member: type, code: DiagnosticId.CS0660, args: [display] });
    if (!overridesObjectMethod(type, 'GetHashCode', 0)) rows.push({ member: type, code: DiagnosticId.CS0661, args: [display] });
  }
  return rows;
}
