/**
 * Definite assignment through expressions: reads, assignments, by-reference arguments, short-circuit
 * operators and the when-true / when-false states of conditions.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { RefKind } from '../../symbols/types.js';
import { join, boundChildren } from './state.js';
import { autoDefaultVersion } from './analyzer-core.js';

/** Class mixin: Definite assignment through expressions: reads, assignments, by-reference arguments, short-circuit */
export const AssignmentExpressions = Base =>
  class extends Base {
    // ---- expressions ----
    /** Evaluates an expression for its effects and returns the state after it. */
    expr(e, state) {
      if (!e || typeof e !== 'object') return state;
      if (!state) {
        this.declareUnreachable(e);
        return state;
      }
      switch (e.kind) {
        case 'Local':
          this.read(e.local, e, state);
          return state;
        case 'Parameter':
          if (e.parameter.refKind === RefKind.Out && this.outs.includes(e.parameter) && !this.isAssigned(e.parameter, state)) {
            this.report(e.syntax, DiagnosticId.CS0269, [e.parameter.name], e.parameter);
            state.add(e.parameter);
          }
          return state;
        case 'This':
          // `this` as a whole (a call on it, passing it on) needs every field of the struct under construction.
          if (this.thisVariable && !this.isAssigned(this.thisVariable, state)) {
            this.report(e.syntax, DiagnosticId.CS0188, [autoDefaultVersion], 'this');
            state.add(this.thisVariable);
          }
          return state;
        case 'FieldAccess': {
          const slot = this.slotOf(e);
          if (!slot) return this.expr(e.receiver, state);
          if (!this.slotAssigned(slot, state)) this.reportUnassignedField(e, slot, state);
          return state;
        }
        case 'PropertyAccess': {
          const slot = this.autoPropertySlot(e);
          if (!slot) return this.expr(e.receiver, state);
          // Reported once per property; the property stays unassigned, so the constructor's exits still report it.
          if (!this.slotAssigned(slot, state)) this.report(e.syntax, DiagnosticId.CS9014, [e.property.toDisplayString(), autoDefaultVersion], slot.key);
          return state;
        }
        case 'Assignment':
        case 'RefAssignment':
        case 'DeconstructionAssignment':
          return this.assign(e.left, this.expr(e.right, this.target(e.left, state)));
        case 'CoalesceAssignment': {
          const after = this.expr(e.left, state),
            right = this.expr(e.right, after.clone());
          return join(after, right) ?? after;
        }
        case 'CompoundAssignment': {
          let s = this.expr(e.left, state);
          s = this.expr(e.right, s);
          return s;
        }
        case 'Increment':
          return this.expr(e.operand, state);
        case 'Binary':
          if (e.operator === '&&' || e.operator === '||') {
            const c = this.cond(e, state);
            return join(c.t, c.f);
          }
          return this.expr(e.right, this.expr(e.left, state));
        case 'Unary':
          return this.expr(e.operand, state);
        case 'Conditional':
        case 'RefConditional': {
          const c = this.cond(e.condition, state);
          return join(this.expr(e.whenTrue, c.t), this.expr(e.whenFalse, c.f));
        }
        case 'Coalesce': {
          const s = this.expr(e.left, state);
          this.expr(e.right, s.clone());
          return s;
        }
        case 'ConditionalAccess': {
          const s = this.expr(e.receiver, state);
          this.expr(e.whenNotNull, s.clone());
          return s;
        }
        case 'IsPattern': {
          const c = this.cond(e, state);
          return join(c.t, c.f);
        }
        case 'Call':
        case 'ObjectCreation':
        case 'ObjectInitializer':
        case 'IndexerAccess':
        case 'DynamicInvocation':
        case 'DynamicElementAccess':
        case 'DynamicObjectCreation':
        case 'Bad': {
          let s = this.expr(e.receiver, state);
          const outs = [];
          if (e.kind === 'Bad') for (const k of ['operand', 'left', 'right']) s = this.expr(e[k], s);
          for (const a of e.args ?? []) {
            const value = a.expression ?? a;
            if (a.refKind === RefKind.Out) {
              s = this.target(value, s);
              outs.push(value);
            } else if (a.refKind === RefKind.Ref && value.kind === 'Local') {
              this.read(value.local, value, s);
            } else s = this.expr(value, s);
          }
          for (const o of outs) s = this.assign(o, s);
          for (const i of e.initializers ?? []) {
            // An index initializer evaluates its arguments before its value.
            for (const a of i.target?.args ?? i.target?.indices ?? []) s = this.expr(a.expression ?? a, s);
            s = this.expr(i.value, s);
          }
          for (const c of e.collectionInitializers ?? []) s = this.expr(c, s);
          return s;
        }
        case 'Lambda': {
          // Captured variables must be assigned where the lambda is created; assignments inside do not flow out.
          if (e.body) {
            const inner = state.clone(),
              saved = this.loops;
            this.loops = [];
            if (e.body.kind && 'completes' in e.body) this.stmt(e.body, inner);
            else this.expr(e.body, inner);
            this.loops = saved;
          }
          return state;
        }
        case 'DeclarationExpression':
        case 'Discard':
        case 'Literal':
        case 'TypeExpression':
        case 'Default':
        case 'TypeOf':
        case 'SizeOf':
        case 'NameOf':
        case 'ConditionalReceiver':
        case 'MethodGroup':
          return state;
        default: {
          let s = state;
          for (const child of boundChildren(e)) s = this.expr(child, s);
          return s;
        }
      }
    }
    /** A read of an unassigned field: CS0170 for a struct local, CS9015 for a field of the struct under construction. */
    reportUnassignedField(e, slot, state) {
      if (slot.variable === this.thisVariable) {
        // Reported once per field; the field stays unassigned, so the constructor's exits still report CS0171.
        this.report(e.syntax, DiagnosticId.CS9015, [e.field.toDisplayString(), autoDefaultVersion], slot.key);
        return;
      }
      this.report(e.syntax, DiagnosticId.CS0170, [e.field.name], slot.key);
      state.add(slot.key);
    }
    /** The backing-field slot of an auto-property of the struct under construction, or null. */
    autoPropertySlot(e) {
      const backingField = e.property?.backingField;
      if (!backingField || e.receiver?.kind !== 'This' || !this.thisVariable) return null;
      return this.fieldSlot(this.rootSlot(this.thisVariable), backingField);
    }
    /** The variable (local, out parameter or struct `this`) an expression denotes directly, or null. */
    variableOf(e) {
      if (!e) return null;
      if (e.kind === 'Local') return e.local;
      if (e.kind === 'Parameter') return e.parameter;
      if (e.kind === 'This') return this.thisVariable ?? null;
      return null;
    }
    read(local, node, state) {
      if (!this.own.has(local) || this.isAssigned(local, state)) return;
      this.report(node.syntax, DiagnosticId.CS0165, [local.name], local);
      state.add(local);
    }
    /** Evaluates the sub-expressions of an assignment target that run before the right-hand side (receivers, indices). */
    target(left, state) {
      if (!left) return state;
      switch (left.kind) {
        case 'Local':
        case 'Parameter':
        case 'Discard':
        case 'DeclarationExpression':
        case 'This':
          return state;
        case 'FieldAccess':
          return this.slotOf(left) ? state : this.expr(left.receiver, state);
        case 'PropertyAccess':
          return this.autoPropertySlot(left) ? state : this.expr(left.receiver, state);
        case 'EventAccess':
          return this.expr(left.receiver, state);
        case 'ArrayAccess': {
          let s = this.expr(left.array, state);
          for (const i of left.indices) s = this.expr(i, s);
          return s;
        }
        case 'IndexerAccess': {
          let s = this.expr(left.receiver, state);
          for (const a of left.args ?? []) s = this.expr(a.expression ?? a, s);
          return s;
        }
        case 'Tuple': {
          // The targets of a deconstruction, left to right.
          let s = state;
          for (const element of left.elements) s = this.target(element, s);
          return s;
        }
        default:
          return this.expr(left, state);
      }
    }
    assign(left, state) {
      if (!state || !left) return state;
      if (left.kind === 'Tuple') {
        for (const element of left.elements) this.assign(element, state);
        return state;
      }
      if (left.kind === 'Local' || left.kind === 'DeclarationExpression') {
        if (left.local) {
          if (left.kind === 'DeclarationExpression') this.declare(left.local);
          state.add(left.local);
        }
        return state;
      }
      if (left.kind === 'Parameter') {
        state.add(left.parameter);
        return state;
      }
      if (left.kind === 'This' && this.thisVariable) {
        state.add(this.thisVariable);
        return state;
      }
      const slot = left.kind === 'FieldAccess' ? this.slotOf(left) : left.kind === 'PropertyAccess' ? this.autoPropertySlot(left) : null;
      if (slot) state.add(slot.key);
      return state;
    }
    /** Evaluates a boolean expression and returns the states when it is true and when it is false. */
    cond(e, state) {
      if (!state) {
        this.declareUnreachable(e);
        return { t: null, f: null };
      }
      if (e.constantValue && e.constantValue.type === 'bool' && e.constantValue.value !== null) {
        const s = this.expr(e, state);
        return e.constantValue.value ? { t: s, f: null } : { t: null, f: s };
      }
      switch (e.kind) {
        case 'Binary':
          if (e.operator === '&&') {
            const l = this.cond(e.left, state),
              r = this.cond(e.right, l.t);
            return { t: r.t, f: join(l.f, r.f) };
          }
          if (e.operator === '||') {
            const l = this.cond(e.left, state),
              r = this.cond(e.right, l.f);
            return { t: join(l.t, r.t), f: r.f };
          }
          break;
        case 'Unary':
          if (e.operator === '!' && !e.method) {
            const c = this.cond(e.operand, state);
            return { t: c.f, f: c.t };
          }
          break;
        case 'Conversion':
          if (e.conversion?.kind === 'Identity') return this.cond(e.operand, state);
          break;
        case 'IsPattern': {
          const s = this.expr(e.operand, state),
            t = s.clone();
          this.patternLocals(e.pattern, t, true);
          // `x is not T t`: the variable is assigned when the test is false.
          if (e.pattern?.kind === 'NotPattern') {
            const f = s.clone();
            this.patternLocals(e.pattern.pattern, f, true);
            return { t: s.clone(), f };
          }
          return { t, f: s };
        }
        case 'Call': {
          // A call's out arguments are assigned in both outcomes.
          const s = this.expr(e, state);
          return { t: s, f: s?.clone() ?? null };
        }
      }
      const s = this.expr(e, state);
      return { t: s, f: s?.clone() ?? null };
    }
    /** An operand that is never evaluated (`false && M(out var x)`) still declares its variables: they stay unassigned. */
    declareUnreachable(e) {
      if (typeof e.kind !== 'string') return;
      if (e.kind === 'DeclarationExpression' && e.local) this.declare(e.local);
      if (e.kind === 'IsPattern') this.patternLocals(e.pattern, null, false);
      for (const child of boundChildren(e)) this.declareUnreachable(child);
    }
    patternLocals(p, state, definite) {
      if (!p) return;
      if (p.local) {
        this.declare(p.local);
        if (definite && state) state.add(p.local);
      }
      if (p.kind === 'AndPattern') {
        this.patternLocals(p.left, state, definite);
        this.patternLocals(p.right, state, definite);
      } else if (p.kind === 'OrPattern' || p.kind === 'NotPattern') {
        this.patternLocals(p.left ?? p.pattern, state, false);
        this.patternLocals(p.right, state, false);
      }
    }
  };
