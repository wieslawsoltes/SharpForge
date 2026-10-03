/**
 * `System.Index` and `System.Range` for compilations bound against the closed framework registry (SF-A02-T67).
 *
 * The registry lists neither type, but the language knows both: `^n` is an `Index`, `a..b` is a `Range`, and an
 * `int` converts implicitly to an `Index`. The definitions are declared in the bridge's core library as structs
 * with the members the language and most programs use; any other member is a framework gap as on every registry
 * type. A referenced core library that declares the types itself is left alone.
 */
import { Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };
const parametersOf = list => list.map(([name, type, options = {}]) => new ParameterSymbol({ name, type, ...options }));

function addProperty(owner, name, type, { isStatic = false } = {}) {
  const modifiers = isStatic ? DeclarationModifiers.Static : DeclarationModifiers.ReadOnly;
  const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: type, modifiers });
  owner.addMember(getMethod);
  owner.addMember(new PropertySymbol({ ...publicMember, name, type, getMethod, modifiers }));
}

function addMethod(owner, name, returnType, parameters, { isStatic = false } = {}) {
  const modifiers = isStatic ? DeclarationModifiers.Static : DeclarationModifiers.ReadOnly;
  owner.addMember(new MethodSymbol({ ...publicMember, name, returnType, parameters: parametersOf(parameters), modifiers }));
}

function addConstructor(owner, core, parameters) {
  owner.addMember(
    new MethodSymbol({
      ...publicMember,
      name: '.ctor',
      methodKind: MethodKind.Constructor,
      returnType: core.void,
      parameters: parametersOf(parameters),
    }),
  );
}

function declareIndex(core, index) {
  addConstructor(index, core, [
    ['value', core.int],
    ['fromEnd', core.bool, { explicitDefaultValue: { value: false } }],
  ]);
  addProperty(index, 'Value', core.int);
  addProperty(index, 'IsFromEnd', core.bool);
  addProperty(index, 'Start', index, { isStatic: true });
  addProperty(index, 'End', index, { isStatic: true });
  addMethod(index, 'FromStart', index, [['value', core.int]], { isStatic: true });
  addMethod(index, 'FromEnd', index, [['value', core.int]], { isStatic: true });
  addMethod(index, 'GetOffset', core.int, [['length', core.int]]);
  addMethod(index, 'Equals', core.bool, [['other', index]]);
  index.addMember(
    new MethodSymbol({
      ...publicMember,
      name: 'op_Implicit',
      methodKind: MethodKind.Conversion,
      returnType: index,
      parameters: parametersOf([['value', core.int]]),
      modifiers: DeclarationModifiers.Static,
    }),
  );
}

function declareRange(core, index, range) {
  addConstructor(range, core, [
    ['start', index],
    ['end', index],
  ]);
  addProperty(range, 'Start', index);
  addProperty(range, 'End', index);
  addProperty(range, 'All', range, { isStatic: true });
  addMethod(range, 'StartAt', range, [['start', index]], { isStatic: true });
  addMethod(range, 'EndAt', range, [['end', index]], { isStatic: true });
  addMethod(range, 'Equals', core.bool, [['other', range]]);
}

/** Declares both definitions once per bridge and returns `{ index, range }` (error types when the bridge has neither). */
export function declareIndexRangeTypes(core) {
  const index = core.bridge.coreType('System_Index'),
    range = core.bridge.coreType('System_Range');
  if (index.isErrorType() || range.isErrorType()) return { index, range };
  // Definitions that already have members come from a referenced core library (or were declared before).
  if (!index.getMembers().length) declareIndex(core, index);
  if (!range.getMembers().length) declareRange(core, index, range);
  return { index, range };
}
