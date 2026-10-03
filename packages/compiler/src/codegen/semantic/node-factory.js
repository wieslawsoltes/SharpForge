/**
 * Builders for the lowered nodes the IR emitter consumes (codegen/ir-emitter.js). Lowering of semantic bound trees and
 * every synthesized method (delegate dispatchers, record members, state machines) is written against these builders,
 * so the emitter contract lives in one place. Types are image type names ('int', 'string', 'Counter', 'int[]').
 */

/** A span shim for sequence points: `{uri,start,end}` plus the sub-spans the emitter reads for loops and conditions. */
export function spanOf(syntax, uri) {
  const span = syntax?.span ?? syntax;
  if (!span || span.start === undefined) return hidden;
  const shim = { uri, start: span.start, end: span.end };
  shim.condition = shim;
  shim.expression = shim;
  shim.increment = shim;
  return shim;
}
/** A span that produces no sequence point (synthesized code). */
export const hidden = Object.freeze({ debugHidden: true, start: 0, end: 0, condition: { end: 0 }, expression: { end: 0 } });

const expression = (kind, legacyType, fields) => ({ kind, legacyType, isExpression: true, ...fields });

/** A local variable the emitter allocates a slot for when its declaration (or sequence) is emitted. */
export function newLocal(name, type, syntax = hidden, extra = {}) {
  return { kind: 'Local', name, legacyType: type, syntax, hidden: syntax === hidden, ...extra };
}
/** The parameter at `ordinal` of the method being emitted. */
export function newParameter(name, type, ordinal) {
  return { kind: 'Parameter', name, legacyType: type, type, ordinal, isThis: false };
}

export const literal = (value, type) => expression('Literal', type, { value });
export const nullLiteral = type => expression('Literal', type, { value: null });
export const local = variable => expression('Local', variable.legacyType, { local: variable });
export const parameter = variable => expression('Parameter', variable.legacyType, { parameter: variable });
export const thisReference = type => expression('ThisReference', type, {});
/** Instance field read (or assignment target): `field` is a ProgramModel field record. */
export const field = (receiver, record) => expression('FieldAccess', record.type, { receiver, field: { legacy: record } });
export const staticField = record => expression('FieldAccess', record.type, { receiver: null, field: { legacy: record } });
export const arrayElement = (array, index) =>
  expression('ArrayAccess', array.legacyType.slice(0, -2), { expression: array, index });
export const arrayLength = array => expression('ArrayLength', 'int', { expression: array });
/** Call of an image method: `receiver` is null for static methods. */
export const call = (method, receiver, args) =>
  expression('Call', method.returnType, { receiver, method: { legacy: method }, args, intrinsic: null });
/** Call of a framework contract or builtin: `member` is the registry symbol (`contract` or `builtin`). */
export function frameworkCall(member, receiver, args, type) {
  if (member.builtin) return expression('Call', type, { receiver, method: {}, args, intrinsic: member.builtin });
  return expression('Call', type, { receiver, method: { contract: member.contract }, args, intrinsic: null });
}
/** `new T` of an image class without running a constructor (fields have their default values). */
export const allocate = record =>
  expression('ObjectCreationExpression', record.name, {
    type: { legacy: record },
    constructorMethod: null,
    args: [],
    initializers: [],
    collectionInitializers: [],
  });
/** `new T(args)` of an image class: allocation, instance initializer, constructor. */
export const construct = (record, constructorMethod, args) =>
  expression('ObjectCreationExpression', record.name, {
    type: { legacy: record },
    constructorMethod: constructorMethod ? { legacy: constructorMethod } : null,
    args,
    initializers: [],
    collectionInitializers: [],
  });
export const newArray = (elementType, length, initializer = null) =>
  expression('ArrayCreation', elementType + '[]', { length, initializer: initializer ?? [], hasInitializer: !!initializer });
export const unary = (operator, operand, type = operand.legacyType, isChecked = false) =>
  expression('UnaryOperator', type, { operator, operand, isChecked });
export const binary = (operator, left, right, type, isChecked = false) =>
  expression('BinaryOperator', type, { operator, left, right, isChecked, method: null, negate: false });
export const equals = (left, right) => binary('==', left, right, 'bool');
export const notEquals = (left, right) => binary('!=', left, right, 'bool');
export const logicalAnd = (left, right) => binary('&&', left, right, 'bool');
export const logicalOr = (left, right) => binary('||', left, right, 'bool');
export const not = operand => unary('!', operand, 'bool');
export const conditional = (condition, consequence, alternative, type = consequence.legacyType) =>
  expression('ConditionalOperator', type, { condition, consequence, alternative });
export const assign = (left, right) => expression('AssignmentOperator', left.legacyType, { left, right });
export const compoundAssign = (operator, left, right, isChecked = false) =>
  expression('CompoundAssignmentOperator', left.legacyType, { operator, left, right, isChecked, method: null, negate: false });
export const increment = (operator, operand, isPostfix, isChecked = false) =>
  expression('IncrementOperator', operand.legacyType, { operator, operand, isPostfix, isChecked });
export const coalesce = (left, right, type = left.legacyType) => expression('NullCoalescingOperator', type, { left, right });
/** Explicit numeric conversion between int and double. */
export const convert = (operand, type, isChecked = false) =>
  expression('Conversion', type, { operand, conversion: null, isExplicit: true, isChecked });
/** Side effects (expressions or statements) evaluated in order, then the value; `locals` are scoped temporaries. */
export const sequence = (locals, sideEffects, value) => expression('Sequence', value.legacyType, { locals, sideEffects, value });
/** A framework delegate over an image method: `receiver` is the target object or null. */
export const frameworkDelegate = (registryTypeName, method, receiver) =>
  expression('DelegateCreationExpression', registryTypeName, { receiver, method: { legacy: method } });

// ---- statements ----
export const block = (statements, locals = [], syntax = hidden) => ({ kind: 'Block', syntax, locals, statements });
export const noOp = () => ({ kind: 'NoOpStatement', syntax: hidden });
/** Declares locals (allocating their slots) with optional initial values: `[local, value|null]` pairs. */
export const declare = (pairs, syntax = hidden) => ({
  kind: 'MultipleLocalDeclarations',
  syntax,
  declarations: pairs.map(([variable, initializer]) => ({ local: variable, initializer: initializer ?? null })),
});
export const expressionStatement = (value, syntax = hidden) => ({ kind: 'ExpressionStatement', syntax, expression: value });
export const ifStatement = (condition, consequence, alternative = null, syntax = hidden) => ({
  kind: 'IfStatement',
  syntax,
  condition,
  consequence,
  alternative,
});
export const whileStatement = (condition, body, syntax = hidden, labels = []) => ({
  kind: 'WhileStatement',
  syntax,
  locals: [],
  condition,
  body,
  labels,
});
export const returnStatement = (value = null, syntax = hidden) => ({ kind: 'ReturnStatement', syntax, expression: value });
export const throwStatement = (value, syntax = hidden) => ({ kind: 'ThrowStatement', syntax, expression: value });
export const tryStatement = (tryBlock, catchBlocks, finallyBlock, syntax = hidden) => ({
  kind: 'TryStatement',
  syntax,
  tryBlock,
  catchBlocks,
  finallyBlock,
});

/** Every builder under one name (`n.literal(...)`): the worker bundler has no namespace imports. */
export const n = Object.freeze({
  spanOf, hidden, newLocal, newParameter, literal, nullLiteral, local, parameter, thisReference, field, staticField, arrayElement, arrayLength, call,
  frameworkCall, allocate, construct, newArray, unary, binary, equals, notEquals, logicalAnd, logicalOr, not, conditional, assign, compoundAssign,
  increment, coalesce, convert, sequence, frameworkDelegate, block, noOp, declare, expressionStatement, ifStatement, whileStatement, returnStatement,
  throwStatement, tryStatement,
});
