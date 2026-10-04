/**
 * Definite assignment through statements: branches join by intersection, loops collect break and continue
 * states, try/finally adds what the finally block assigns.
 */
import { join } from './state.js';

/** Class mixin: Definite assignment through statements: branches join by intersection, loops collect break and continue */
export const AssignmentStatements = Base =>
  class extends Base {
    stmt(s, state) {
      if (!s || !state) return state && s ? state : null;
      switch (s.kind) {
        case 'Block': {
          let st = state;
          for (const x of s.statements) {
            if (x.kind === 'LocalFunction') this.localFunction(x, st);
            else if (st) st = this.stmt(x, st);
          }
          return st;
        }
        case 'Empty':
        case 'Bad':
          return state;
        case 'ExpressionStatement': {
          const after = this.expr(s.expression, state);
          return s.completes === false ? null : after;
        }
        case 'ExpressionBody': {
          const after = this.expr(s.expression, state);
          if (s.isReturn) {
            this.leave(after, null);
            return null;
          }
          return after;
        }
        case 'LocalDeclaration':
          return this.declarations(s.declarations, state);
        case 'If': {
          const c = this.cond(s.condition, state);
          return join(this.stmt(s.then, c.t), s.otherwise ? this.stmt(s.otherwise, c.f) : c.f);
        }
        case 'While': {
          const c = this.cond(s.condition, state),
            loop = this.enter(true);
          this.stmt(s.body, c.t);
          this.loops.pop();
          return join(c.f, loop.breaks);
        }
        case 'Do': {
          const loop = this.enter(true),
            after = this.stmt(s.body, state.clone());
          this.loops.pop();
          const c = this.cond(s.condition, join(after, loop.continues));
          return join(c.f, loop.breaks);
        }
        case 'For': {
          let st = this.declarations(s.declaration ?? [], state);
          for (const i of s.initializers) st = this.expr(i, st);
          const c = s.condition ? this.cond(s.condition, st) : { t: st, f: null },
            loop = this.enter(true),
            after = this.stmt(s.body, c.t?.clone() ?? null);
          this.loops.pop();
          let inc = join(after, loop.continues);
          for (const i of s.incrementors) inc = this.expr(i, inc);
          return join(c.f, loop.breaks);
        }
        case 'ForEach': {
          const st = this.expr(s.collection, state);
          if (s.local) this.declare(s.local);
          const inner = st.clone();
          if (s.local) inner.add(s.local);
          const loop = this.enter(true);
          this.stmt(s.body, inner);
          this.loops.pop();
          return join(st, loop.breaks);
        }
        case 'Switch': {
          const st = this.expr(s.governing, state),
            sw = this.enter(false);
          let exhaustive = false,
            fallout = null;
          for (const section of s.sections) {
            let entry = st.clone();
            for (const l of section.labels) {
              if (l.kind === 'default' || l.kind === 'DiscardPattern') exhaustive = true;
              if (l.local) {
                this.declare(l.local);
                if (section.labels.length === 1) entry.add(l.local);
              }
              if (!l.when) continue;
              // The section runs when the guard is true: what `when x is T t` or `when f(out var v)` assigns is assigned there.
              // (The guard itself sees the variable of its own label, also when the section has several labels.)
              const guardEntry = section.labels.length === 1 || !l.local ? entry : entry.clone();
              if (guardEntry !== entry) guardEntry.add(l.local);
              const whenTrue = this.cond(l.when, guardEntry).t;
              if (section.labels.length === 1 && whenTrue) entry = whenTrue;
            }
            const end = this.stmt(section.body, entry);
            if (end) fallout = join(fallout, end);
          }
          this.loops.pop();
          let result = sw.breaks;
          if (!exhaustive) result = join(result, st);
          if (fallout) result = join(result, fallout);
          return result;
        }
        case 'Return': {
          const after = s.expression ? this.expr(s.expression, state) : state;
          this.leave(after, s.syntax);
          return null;
        }
        case 'Throw':
          if (s.expression) this.expr(s.expression, state);
          return null;
        case 'YieldBreak':
          return null;
        case 'YieldReturn':
          return this.expr(s.expression, state);
        case 'Break': {
          const target = this.loops.at(-1);
          if (target) target.breaks = join(target.breaks, state) ?? state.clone();
          return null;
        }
        case 'Continue': {
          const target = [...this.loops].reverse().find(l => l.isLoop);
          if (target) target.continues = join(target.continues, state) ?? state.clone();
          return null;
        }
        case 'Goto':
          return null;
        case 'Labeled':
          return this.stmt(s.statement, state);
        case 'Checked':
        case 'Unsafe':
          return this.stmt(s.block, state);
        case 'Lock':
          return this.stmt(s.body, this.expr(s.expression, state));
        case 'Using': {
          let st = Array.isArray(s.resources) ? this.declarations(s.resources, state) : this.expr(s.resources, state);
          return this.stmt(s.body, st);
        }
        case 'Fixed':
          return this.stmt(s.body, this.declarations(s.declaration ?? [], state));
        case 'Try': {
          const entry = state.clone(),
            tryEnd = this.stmt(s.body, state.clone());
          let result = tryEnd;
          for (const c of s.catches) {
            const cs = entry.clone();
            if (c.local) {
              this.declare(c.local);
              cs.add(c.local);
            }
            if (c.filter) this.expr(c.filter, cs);
            result = join(result, this.stmt(c.block, cs));
          }
          if (s.finallyBlock) {
            const fin = this.stmt(s.finallyBlock, entry.clone());
            if (!fin) return null;
            if (result) for (const k of fin.set) if (!entry.has(k)) result.add(k);
          }
          return result;
        }
        case 'LocalFunction':
          this.localFunction(s, state);
          return state;
        default:
          return state;
      }
    }
    declarations(list, state) {
      let st = state;
      for (const d of list) {
        this.declare(d.local);
        if (d.value) {
          st = this.expr(d.value, st);
          if (st) st.add(d.local);
        }
      }
      return st;
    }
    enter(isLoop) {
      const l = { isLoop, breaks: null, continues: null };
      this.loops.push(l);
      return l;
    }
    /** Local functions are analysed with every captured variable taken as assigned (their call sites decide in Roslyn). */
    localFunction(s, state) {
      const body = s.method?.body;
      if (!body) return;
      const inner = new this.constructor(s.method, this.o);
      inner.diagnostics = this.diagnostics;
      inner.reported = this.reported;
      inner.run(body);
    }
  };
