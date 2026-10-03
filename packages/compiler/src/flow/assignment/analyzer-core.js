/**
 * Definite assignment state and bookkeeping: tracked variables, struct fields, diagnostics and the exit
 * checks for out parameters and struct constructors.
 */
import { SymbolKind, TypeKind, RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { structInstanceFields } from '../../binder/structs.js';
import { isUserStruct, AssignmentState, fieldKey } from './state.js';

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
    return isUserStruct(type) ? structInstanceFields(type.originalDefinition ?? type) : [];
  }
  isAssigned(variable, state) {
    if (!state || state.has(variable)) return true;
    const fields = this.fieldsOf(variable.type);
    return fields.length > 0 && fields.every(f => state.has(fieldKey(variable, f)));
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
          'CS0177',
          [p.name],
          'out:' + p.name + ':' + (this.exitNode(node).span?.start ?? this.exitNode(node).start),
        );
    if (this.thisVariable && this.o.languageVersion < 11 && !state.has(this.thisVariable)) {
      for (const f of this.fieldsOf(this.thisVariable.type))
        if (!state.has(fieldKey(this.thisVariable, f)))
          this.report(this.method.locations[0], 'CS0171', [(f.associatedSymbol ?? f).toDisplayString(), '11.0'], 'field:' + f.name);
    }
  }
  /** CS0177 is reported on the return statement that leaves, or on the method name when control falls off the end. */
  exitNode(node) {
    return node ?? this.method?.locations?.[0] ?? { start: 0, end: 1 };
  }
  run(body) {
    const state = new AssignmentState();
    // A struct constructor without `: this(...)` starts with every field unassigned.
    const type = this.o.containingType;
    if (
      this.method?.methodKind === MethodKind.Constructor &&
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
