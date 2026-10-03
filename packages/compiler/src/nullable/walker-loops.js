/**
 * Null-state through loops and `break` / `continue` (SF-A02-T05.4).
 *
 * A loop body can change the state its own head sees on the next iteration (`s = null;` at the end of the body
 * makes `s` maybe-null at the top). Like Roslyn, the walker therefore repeats the loop until the state at the head
 * stops changing: the head state is the join of the state entering the loop and the state flowing back from the
 * end of the body and from every `continue`. States only ever move towards maybe-null, so the iteration ends after
 * a few rounds. Diagnostics of the trial rounds are discarded; one final round over the fixed state reports them,
 * so nothing is reported twice and nothing is reported for a state that a later round widens.
 * `goto` is not followed: a method that jumps backwards with `goto` is analysed as if the jump ended the path.
 */
import { joinFlow } from './flow-state.js';

/** More rounds than any state can need (each variable changes at most twice); a guard against a walker defect. */
const maxRounds = 16;

/** True when two flow states (or two unreachable paths) are the same. */
export function sameFlow(a, b) {
  if (!a || !b) return !a && !b;
  if (a.entries.size !== b.entries.size) return false;
  for (const [variable, state] of a.entries) {
    if (b.entries.get(variable) !== state) return false;
  }
  return true;
}

const constantCondition = condition => (condition?.constantValue?.type === 'bool' ? condition.constantValue.value : null);

/** Class mixin over the walker core: loops, switch statements and the jumps that leave or repeat them. */
export const NullableLoops = Base =>
  class extends Base {
    /**
     * Repeats `pass(head)` until the state at the loop head is stable, then runs it once more with diagnostics on.
     * @param entry the state entering the loop
     * @param {(head: object) => { back: object|null, exit: object|null }} pass walks one iteration from the head
     *   state and returns the state flowing back to the head and the state leaving the loop
     * @returns the state after the loop (null when it never exits)
     */
    fixedPoint(entry, pass) {
      let head = entry.clone();
      const reported = this.diagnostics;
      this.diagnostics = [];
      try {
        for (let round = 0; round < maxRounds; round++) {
          const next = joinFlow(entry, pass(head.clone()).back);
          if (sameFlow(next, head)) break;
          head = next;
        }
      } finally {
        this.diagnostics = reported;
      }
      return pass(head).exit;
    }
    /** Walks a loop body with a frame that collects the states of its `break` and `continue` statements. */
    loopBody(body, flow) {
      const frame = { isLoop: true, breaks: null, continues: null };
      this.jumpTargets.push(frame);
      const end = this.statement(body, flow);
      this.jumpTargets.pop();
      return { next: joinFlow(end, frame.continues), breaks: frame.breaks };
    }
    /** The branches of a loop condition; a constant condition makes one of them unreachable. */
    loopCondition(condition, flow) {
      const branches = this.condition(condition, flow);
      const constant = constantCondition(condition);
      if (constant === true) return { whenTrue: branches.whenTrue, whenFalse: null };
      if (constant === false) return { whenTrue: null, whenFalse: branches.whenFalse };
      return branches;
    }
    whileLoop(node, flow) {
      return this.fixedPoint(flow, head => {
        const branches = this.loopCondition(node.condition, head);
        const body = this.loopBody(node.body, branches.whenTrue);
        return { back: body.next, exit: joinFlow(branches.whenFalse, body.breaks) };
      });
    }
    doLoop(node, flow) {
      return this.fixedPoint(flow, head => {
        const body = this.loopBody(node.body, head);
        const branches = body.next ? this.loopCondition(node.condition, body.next) : { whenTrue: null, whenFalse: null };
        return { back: branches.whenTrue, exit: joinFlow(branches.whenFalse, body.breaks) };
      });
    }
    forLoop(node, flow) {
      const entry = this.declarations(node.declaration ?? [], flow);
      for (const initializer of node.initializers) this.expression(initializer, entry);
      return this.fixedPoint(entry, head => {
        const branches = node.condition ? this.loopCondition(node.condition, head) : { whenTrue: head, whenFalse: null };
        const body = this.loopBody(node.body, branches.whenTrue);
        if (body.next) for (const incrementor of node.incrementors) this.expression(incrementor, body.next);
        return { back: body.next, exit: joinFlow(branches.whenFalse, body.breaks) };
      });
    }
    forEachLoop(node, flow) {
      this.dereference(node.collection, flow);
      return this.fixedPoint(flow, head => {
        const body = this.loopBody(node.body, head.clone());
        // The collection may be empty or run out: the loop is left from its head, or by a `break`.
        return { back: body.next, exit: joinFlow(head, body.breaks) };
      });
    }
    switchStatement(node, flow) {
      this.expression(node.governing, flow);
      const frame = { isLoop: false, breaks: null, continues: null };
      this.jumpTargets.push(frame);
      let result = flow.clone();
      for (const section of node.sections) result = joinFlow(result, this.statement(section.body, flow.clone()));
      this.jumpTargets.pop();
      return joinFlow(result, frame.breaks);
    }
    /** `break` leaves the innermost loop or switch with the current state. */
    breakStatement(flow) {
      const target = this.jumpTargets.at(-1);
      if (target) target.breaks = joinFlow(target.breaks, flow);
      return null;
    }
    /** `continue` carries the current state to the next iteration of the innermost loop. */
    continueStatement(flow) {
      const target = this.jumpTargets.findLast(frame => frame.isLoop);
      if (target) target.continues = joinFlow(target.continues, flow);
      return null;
    }
  };
