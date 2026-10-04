/**
 * The state of one method body being emitted (SF-A02-T30) and the dispatch over bound nodes. The construct families
 * are class mixins (emit-*.js) composed in method-emitter.js; each adds `expr<Kind>` and `stmt<Kind>` handlers.
 *
 * Conventions of the handlers:
 *   expression(node)   leaves the value of the node on the evaluation stack (nothing for a `void` call)
 *   effect(node)       evaluates the node and leaves the stack as it was
 *   statement(node)    starts and ends with an empty evaluation stack
 */
import { walk } from '../../bound/semantic-walker.js';
import { IlBuilder } from './il-builder.js';
import { UnsupportedInCil, describeKind } from './unsupported.js';
import { isVoid } from './type-facts.js';

const labelPresence = new WeakMap();

/** True when a statement is, or contains, a labeled statement (functions nested in it have labels of their own). */
function containsLabel(statement) {
  let found = labelPresence.get(statement);
  if (found === undefined) {
    found = false;
    walk(statement, node => {
      if (node.kind === 'Labeled') found = true;
      return !found && node.kind !== 'Lambda' && node.kind !== 'LocalFunction';
    });
    labelPresence.set(statement, found);
  }
  return found;
}

export class EmitterCore {
  /**
   * @param program `{analysis, core, tokens}`: the analysed compilation and the token source of the assembly
   * @param {{uri: string, containingType: object, isStatic: boolean, parameters: object[], returnType: object,
   *   method: object|null}} frame the method whose body this is
   */
  constructor(program, frame) {
    this.program = program;
    this.core = program.core;
    this.tokens = program.tokens;
    this.frame = frame;
    this.il = this.createInstructionStream(frame);
    this.slots = new Map();
    this.argumentIndexes = new Map();
    frame.parameters.forEach((parameter, index) => this.argumentIndexes.set(parameter, index + (frame.isStatic ? 0 : 1)));
    /** Enclosing loops and switches: where `break` and `continue` go, and how many protected regions surround them. */
    this.jumpTargets = [];
    this.protectedDepth = 0;
    this.returnLabel = null;
    this.returnSlot = null;
    /**
     * Bound nodes whose value is already at hand (the target of a compound assignment, the object an initializer
     * fills): node -> `{value(), address()?}`, each pushing it.
     */
    this.substitutions = new Map();
    /** The node being assigned to, while its location is resolved (a get-only auto-property is then its field). */
    this.assignmentTarget = null;
    /** The section labels of the enclosing switch statements, for `goto case`. */
    this.switchSections = new Map();
  }
  /** The instruction stream of the body; a family that needs more than the plain stream supplies its own. */
  createInstructionStream() {
    return new IlBuilder();
  }
  unsupported(construct, syntax = null) {
    throw new UnsupportedInCil(construct, syntax, this.frame.uri);
  }
  /** Emits an expression whose value is used. */
  expression(node) {
    if (node.hasErrors) return this.unsupported('an expression the binder could not bind', node.syntax);
    const substitute = this.substitutions.get(node);
    if (substitute) return substitute.value();
    if (this.constant(node)) return undefined;
    const handler = this['expr' + node.kind];
    if (!handler) return this.unsupported(`${describeKind(node.kind)} expressions`, node.syntax);
    return handler.call(this, node, true);
  }
  /**
   * Emits an expression for its side effects. A handler is called with `isUsed` false and returns false when it left
   * no value on the stack (an assignment that skipped the copy of the stored value); otherwise the value is popped.
   */
  effect(node) {
    if (node.hasErrors) return this.unsupported('an expression the binder could not bind', node.syntax);
    if (node.constantValue && node.kind !== 'Lambda') return undefined;
    const handler = this['expr' + node.kind];
    if (!handler) return this.unsupported(`${describeKind(node.kind)} expressions`, node.syntax);
    const leftValue = handler.call(this, node, false) !== false;
    if (leftValue && !isVoid(node.type)) this.il.emit('pop');
    return undefined;
  }
  statement(node) {
    // A statement that cannot be reached emits nothing, unless a label inside it can be the target of a `goto`.
    if (!this.il.isReachable && !containsLabel(node)) return undefined;
    const handler = this['stmt' + node.kind];
    if (!handler) return this.unsupported(`${describeKind(node.kind)} statements`, node.syntax);
    return handler.call(this, node);
  }
  /** A compiler temporary of the given type. */
  temp(type, options) {
    return this.il.declareLocal(type, options);
  }
  /**
   * Emits a whole body: a Block, an expression body or the bare expression of a lambda.
   * @param {(emitter: this) => void} [prologue] code that runs before the body (a constructor's initialization)
   */
  body(bound, prologue = null) {
    this.enterBody();
    if (prologue) prologue(this);
    if (bound) this.bodyStatements(bound);
    return this.finish();
  }
  /** Runs before anything else of a body; the closure family moves captured parameters into their cells here. */
  enterBody() {}
  bodyStatements(bound) {
    if (bound.kind === 'Block') this.statement(bound);
    else if (bound.kind === 'ExpressionBody') this.expressionBody(bound.expression, !!bound.isReturn);
    else this.expressionBody(bound, !isVoid(this.frame.returnType));
  }
  expressionBody(expression, isReturn) {
    if (!isReturn) {
      this.effect(expression);
      return;
    }
    this.expression(expression);
    this.il.emit('ret', undefined, { pops: 1, pushes: 0 });
  }
  /** Ends the method: the implicit return of a `void` body and the shared return point of returns in protected regions. */
  finish() {
    const il = this.il,
      returnsValue = !isVoid(this.frame.returnType);
    if (il.isReachable) {
      if (!returnsValue) il.emit('ret', undefined, { pops: 0, pushes: 0 });
      // Flow analysis has shown that the end is not reached; the verifier still wants the stream to end in a transfer.
      else il.emit('ldnull').emit('throw');
    }
    if (this.returnLabel) {
      il.mark(this.returnLabel);
      if (returnsValue) il.emit('ldloc', this.returnSlot);
      il.emit('ret', undefined, { pops: returnsValue ? 1 : 0, pushes: 0 });
    }
    return il;
  }
}
