/**
 * Definite assignment state and bookkeeping: tracked variables, struct fields, diagnostics and the exit
 * checks for out parameters and struct constructors.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { structInstanceFields } from '../../binder/structs.js';
import { isUserStruct, isTupleStruct, AssignmentState, fieldKey, nestedFieldKey } from './state.js';

/** The language version from which struct constructors auto-default their fields (named in CS0171, CS0843, CS0188). */
export const autoDefaultVersion = '11.0';

export class AssignmentAnalyzerCore {
  constructor(method, options) {
    this.method = method;
    this.o = options;
    this.diagnostics = [];
    this.reported = new Set();
    this.loops = [];
    this.own = new Set();
    this.outs = (method?.parameters ?? []).filter(p => p.refKind === RefKind.Out);
  }
  report(node, code, args, key) {
    if (key !== undefined) {
      if (this.reported.has(key)) return;
      this.reported.add(key);
    }
    this.diagnostics.push({ node, code, args });
  }
  fieldsOf(type) {
    if (isTupleStruct(type)) return type.getMembers().filter(member => member.kind === SymbolKind.Field);
    return isUserStruct(type) ? structInstanceFields(type.originalDefinition ?? type) : [];
  }
  isAssigned(variable, state) {
    if (!state || state.has(variable)) return true;
    return this.allFieldsAssigned(this.rootSlot(variable), state);
  }
  /** The slot of a whole tracked variable. A slot is `{ key, type, parent, variable }`; fields of struct slots are slots too. */
  rootSlot(variable) {
    return { key: variable, type: variable.type, parent: null, variable };
  }
  fieldSlot(parent, field) {
    const key = parent.parent ? nestedFieldKey(parent.key, field) : fieldKey(parent.variable, field);
    return { key, type: field.type, parent, variable: parent.variable, field };
  }
  /** The tracked storage an expression denotes: a variable or a (nested) instance field of a struct variable. */
  slotOf(expression) {
    if (!expression) return null;
    if (expression.kind === 'FieldAccess') {
      if (expression.field.isStatic) return null;
      const parent = this.slotOf(expression.receiver);
      return parent && isUserStruct(parent.type) ? this.fieldSlot(parent, expression.field) : null;
    }
    const variable = this.variableOf(expression);
    return variable && this.tracked(variable) ? this.rootSlot(variable) : null;
  }
  /** A slot is assigned when it or an enclosing slot was assigned as a whole, or every field of it was. */
  slotAssigned(slot, state) {
    for (let current = slot; current; current = current.parent) {
      if (state.has(current.key)) return true;
    }
    return this.allFieldsAssigned(slot, state);
  }
  allFieldsAssigned(slot, state) {
    const fields = this.fieldsOf(slot.type);
    if (!fields.length) return false;
    return fields.every(field => {
      const child = this.fieldSlot(slot, field);
      return state.has(child.key) || this.allFieldsAssigned(child, state);
    });
  }
  tracked(variable) {
    return this.own.has(variable) || this.outs.includes(variable) || variable === this.thisVariable;
  }
  // ---- statements ----
  declare(local) {
    this.own.add(local);
  }
  /** Control leaves the method: out parameters must be assigned, and - before C# 11 - every field of a struct under construction. */
  leave(state, node) {
    if (!state) return;
    for (const p of this.outs)
      if (!this.isAssigned(p, state))
        this.report(
          this.exitNode(node),
          DiagnosticId.CS0177,
          [p.name],
          'out:' + p.name + ':' + (this.exitNode(node).span?.start ?? this.exitNode(node).start),
        );
    if (this.thisVariable && !state.has(this.thisVariable)) this.leaveStructConstructor(state, node);
  }
  /**
   * Before C# 11 a struct constructor must assign every field before it returns: CS0171 for a field, CS0843 for an
   * auto-property, on the `return` statement that leaves or on the constructor name when control falls off the end.
   */
  leaveStructConstructor(state, node) {
    const exit = this.exitNode(node);
    const position = exit.span?.start ?? exit.start;
    const thisSlot = this.rootSlot(this.thisVariable);
    for (const field of this.fieldsOf(this.thisVariable.type)) {
      const slot = this.fieldSlot(thisSlot, field);
      if (state.has(slot.key) || this.allFieldsAssigned(slot, state)) continue;
      const property = field.associatedSymbol;
      const code = property ? DiagnosticId.CS0843 : DiagnosticId.CS0171;
      this.report(exit, code, [(property ?? field).toDisplayString(), autoDefaultVersion], `field:${field.name}:${position}`);
    }
  }
  /** CS0177 is reported on the return statement that leaves, or on the method name when control falls off the end. */
  exitNode(node) {
    return node ?? this.method?.locations?.[0] ?? { start: 0, end: 1 };
  }
  run(body) {
    const state = new AssignmentState();
    // Before C# 11 a struct constructor without `: this(...)` starts with every field unassigned; from C# 11 the
    // compiler defaults whatever the constructor leaves unassigned, so `this` is not tracked at all.
    const type = this.o.containingType;
    if (
      this.method?.methodKind === MethodKind.Constructor &&
      this.o.languageVersion < 11 &&
      isUserStruct(type) &&
      this.method.initializerSyntax?.kind !== 'ThisConstructorInitializer' &&
      !this.method.isLocalFunctionAnalysis
    ) {
      this.thisVariable = { name: 'this', type, kind: SymbolKind.Parameter, isThis: true };
      // Field and auto-property initializers run first.
      for (const m of type.getMembers())
        if (!m.isStatic && m.initializerSyntax) {
          const f = m.kind === SymbolKind.Property ? m.backingField : m;
          if (f) state.add(fieldKey(this.thisVariable, f));
        }
    }
    const end = this.stmt(body, state);
    if (end) this.leave(end, null);
    return this.diagnostics;
  }
}
