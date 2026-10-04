/**
 * Predefined operators reached through user-defined implicit conversions (C# spec 12.4.4-12.4.5): when an operand is
 * of a class or struct that declares implicit conversions, the predefined operators are candidates of ordinary
 * overload resolution - `meters + 1.5` picks `double +(double, double)` when `Meters` converts to `double`.
 *
 * The fast paths of overload/operators.js decide from the operand types alone and never see such an operand; this
 * module is consulted only after they found nothing, so it does not change how predefined operands resolve.
 * Signatures are built once per set of core types.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind } from '../symbols/types.js';
import { MethodSymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from '../symbols/members.js';
import { stripNullable } from '../conversions/nullable.js';
import { baseTypeChain } from '../symbols/substitution.js';

const numeric = ['int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal'];
const integral = ['int', 'uint', 'long', 'ulong'];
const signed = ['int', 'long', 'float', 'double', 'decimal'];
const groups = Object.freeze({ arithmetic: ['+', '-', '*', '/', '%'], comparison: ['<', '>', '<=', '>='], equality: ['==', '!='] });
const tables = new WeakMap();

function signature(name, parameterTypes, returnType, info) {
  const parameters = parameterTypes.map((type, ordinal) => new ParameterSymbol({ name: ordinal ? 'right' : 'left', type, ordinal }));
  const modifiers = DeclarationModifiers.Static;
  const method = new MethodSymbol({ name, methodKind: MethodKind.UserDefinedOperator, returnType, parameters, modifiers });
  method.predefined = info;
  return method;
}

/** Operator text -> candidate signatures, for binary and for unary operators. */
function buildTables(core) {
  const type = kind => core.keyword(kind),
    binary = new Map(),
    unary = new Map(),
    add = (map, operator, method) => map.set(operator, [...(map.get(operator) ?? []), method]),
    same = (operator, kinds, family, result = kind => type(kind)) => {
      for (const kind of kinds) add(binary, operator, signature(operator, [type(kind), type(kind)], result(kind), { family, operandKind: kind }));
    };
  for (const operator of groups.arithmetic) same(operator, numeric, 'numeric');
  for (const operator of groups.comparison) same(operator, numeric, 'numeric', () => core.bool);
  for (const operator of groups.equality) {
    same(operator, numeric, 'numeric', () => core.bool);
    add(binary, operator, signature(operator, [core.bool, core.bool], core.bool, { family: 'bool' }));
    add(binary, operator, signature(operator, [core.string, core.string], core.bool, { family: 'string' }));
  }
  for (const operator of ['&', '|', '^']) {
    same(operator, integral, 'numeric');
    add(binary, operator, signature(operator, [core.bool, core.bool], core.bool, { family: 'bool' }));
  }
  for (const operator of ['<<', '>>'])
    for (const kind of integral) add(binary, operator, signature(operator, [type(kind), core.int], type(kind), { family: 'shift' }));
  for (const [left, right] of [
    [core.string, core.string],
    [core.string, core.object],
    [core.object, core.string],
  ])
    add(binary, '+', signature('+', [left, right], core.string, { family: 'string' }));
  for (const kind of numeric) add(unary, '+', signature('+', [type(kind)], type(kind), { family: 'numeric', operandKind: kind }));
  for (const kind of signed) add(unary, '-', signature('-', [type(kind)], type(kind), { family: 'numeric', operandKind: kind }));
  for (const kind of integral) add(unary, '~', signature('~', [type(kind)], type(kind), { family: 'numeric', operandKind: kind }));
  add(unary, '!', signature('!', [core.bool], core.bool, { family: 'bool' }));
  return { binary, unary };
}

/** True for a class or struct that declares (or inherits) a user-defined implicit conversion. */
export function declaresImplicitConversion(type, core) {
  const plain = type ? stripNullable(type) : null;
  if (!plain || plain.specialType || (plain.typeKind !== TypeKind.Class && plain.typeKind !== TypeKind.Struct)) return false;
  return baseTypeChain(plain, core).some(t => t.getMembers('op_Implicit').some(m => m.kind === SymbolKind.Method));
}

/**
 * Resolves a predefined operator over operands that need user-defined conversions.
 * @param resolver the OperatorResolver (`core`, `overloads`)  @param {object[]} operands one or two bound operands
 * @returns the builtin result, `{ambiguous: true}` when two signatures are equally good, or null when none applies
 */
export function resolvePredefinedOperator(resolver, operator, operands) {
  const core = resolver.core;
  if (!operands.some(operand => declaresImplicitConversion(operand.type, core))) return null;
  let table = tables.get(core);
  if (!table) tables.set(core, (table = buildTables(core)));
  const candidates = (operands.length === 1 ? table.unary : table.binary).get(operator);
  if (!candidates) return null;
  const result = resolver.overloads.resolve(candidates, operands, { name: operator });
  if (!result.succeeded) return result.error?.code === DiagnosticId.CS0121 ? { ambiguous: true } : null;
  const method = result.method;
  return {
    kind: 'builtin',
    family: method.predefined.family,
    leftType: method.parameters[0].type,
    rightType: method.parameters[1]?.type ?? null,
    resultType: method.returnType,
    isLifted: false,
    ...(method.predefined.operandKind ? { operandKind: method.predefined.operandKind } : {}),
  };
}
