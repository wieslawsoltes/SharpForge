import {ScalarTranslation} from './scalar-translation.js';
/**
 * Lowers one semantic bound body (binder/body-binder.js) to the nodes the IR emitter consumes. The translator owns
 * the per-body state: where each variable lives (a slot, a parameter or a closure cell), the locals of the block
 * being built, and the temporaries an expression needs before its statement runs.
 *
 * The expression and statement families are class mixins (translate-*.js) composed at the bottom of this file.
 */
import { hoistedLocalFieldName, hoistedSynthesizedLocalFieldName } from '../../lowering/generated-names.js';
import { n } from './node-factory.js';
import { ExpressionTranslation } from './translate-expressions.js';
import { CallTranslation } from './translate-calls.js';
import { FunctionTranslation } from './translate-functions.js';
import { PatternTranslation } from './translate-patterns.js';
import { StatementTranslation } from './translate-statements.js';
import { JumpTranslation } from './translate-jumps.js';
import { RuntimeGapTranslation } from './runtime-gaps.js';
import { ArrayTranslation } from '../../lowering/arrays.js';
import { AwaitTranslation } from '../../lowering/async/async-methods.js';
import { AsyncStreamTranslation } from '../../lowering/async/async-streams.js';
import { ByReferenceTranslation } from '../../lowering/by-reference.js';
import { Locations } from '../../lowering/tuples/locations.js';
import { TupleTranslation } from '../../lowering/tuples/translate-tuples.js';
import { SynthesizedTextTranslation } from '../../lowering/tuples/translate-text.js';
import { DeconstructionTranslation } from '../../lowering/tuples/translate-deconstruction.js';
import { memberLowerings } from '../../lowering/members/index.js';
import { InitializerLowering } from '../../lowering/members/initializers.js';
import { RecordTranslation } from '../../lowering/records/translate-records.js';
import { StructuralPatternTranslation } from '../../lowering/patterns/translate-structural-patterns.js';
import { languageLowerings } from '../../lowering/language-lowerings.js';
import { GenericTranslation } from '../../lowering/generics/index.js';

export { Frame } from './frame.js';

class TranslatorCore {
  /** @param generator the SemanticGenerator  @param {Frame} frame */
  constructor(generator, frame) {
    this.g = generator;
    this.frame = frame;
    this.types = generator.types;
    this.scopes = [[]];
    this.pending = [];
    this.temps = 0;
  }
  unsupported(construct, syntax) {
    return this.g.unsupported(construct, syntax, this.frame.uri);
  }
  imageType(type, syntax) {
    return this.types.imageType(type, syntax);
  }
  span(syntax) {
    const shim = n.spanOf(syntax, this.frame.uri);
    if (shim === n.hidden) return shim;
    if (syntax.condition) shim.condition = n.spanOf(syntax.condition, this.frame.uri);
    if (syntax.expression) shim.expression = n.spanOf(syntax.expression, this.frame.uri);
    if (syntax.governingExpression) shim.expression = n.spanOf(syntax.governingExpression, this.frame.uri);
    if (syntax.incrementors?.length) {
      const first = syntax.incrementors[0].span,
        last = syntax.incrementors.at(-1).span;
      shim.increment = { uri: this.frame.uri, start: first.start, end: last.end };
    }
    return shim;
  }
  /** A compiler temporary. Hidden locals of a method share one debug scope, so every temporary gets a unique name. */
  temp(type, hint = 't') {
    return n.newLocal(`$${hint}${this.temps++}`, type);
  }
  // ---- variables ----
  /** Registers a local of the block being built (its slot is released when the block ends). */
  addBlockLocal(variable) {
    this.scopes.at(-1).push(variable);
    return variable;
  }
  /**
   * Declares a source local or parameter symbol and returns the statements that create it.
   * A captured variable lives in a cell: the slot holds the cell and reads go through its value field.
   * @param symbol the LocalSymbol  @param initializer lowered initial value or null  @param syntax span shim
   */
  declareVariable(symbol, initializer, syntax = n.hidden) {
    if (this.frame.hoist) return this.hoistVariable(symbol, initializer, syntax);
    const type = this.imageType(symbol.type, symbol.syntax);
    const span = symbol.syntax ? n.spanOf(symbol.syntax, this.frame.uri) : n.hidden;
    if (!this.frame.captures.isCaptured(symbol)) {
      const variable = this.addBlockLocal(n.newLocal(symbol.name, type, span, { hidden: false, isConst: symbol.isConst }));
      this.frame.vars.set(symbol, () => n.local(variable));
      return [n.declare([[variable, initializer]], syntax)];
    }
    const cell = this.g.cellClass(type),
      holder = this.addBlockLocal(n.newLocal(symbol.name, cell.record.name, span, { hidden: false }));
    this.frame.cells.set(symbol, () => n.local(holder));
    this.frame.vars.set(symbol, () => n.field(n.local(holder), cell.value));
    const statements = [n.declare([[holder, n.allocate(cell.record)]], syntax)];
    if (initializer) statements.push(n.expressionStatement(n.assign(n.field(n.local(holder), cell.value), initializer)));
    return statements;
  }
  /** In a state machine a variable is a field of the machine object, so that it survives a `yield`. */
  hoistVariable(symbol, initializer, syntax) {
    const hoist = this.frame.hoist,
      type = this.imageType(symbol.type, symbol.syntax),
      captured = this.frame.captures.isCaptured(symbol),
      cell = captured ? this.g.cellClass(type) : null,
      name = hoistedLocalFieldName(symbol.name, ++hoist.slots),
      slot = this.g.iterators.addField(hoist.info, hoist.machine, name, cell ? cell.record.name : type),
      read = () => n.field(hoist.self(), slot);
    if (!cell) {
      this.frame.vars.set(symbol, read);
      return [n.expressionStatement(n.assign(read(), initializer ?? this.defaultValue(type)), syntax)];
    }
    this.frame.cells.set(symbol, read);
    this.frame.vars.set(symbol, () => n.field(read(), cell.value));
    const statements = [n.expressionStatement(n.assign(read(), n.allocate(cell.record)), syntax)];
    if (initializer) statements.push(n.expressionStatement(n.assign(n.field(read(), cell.value), initializer)));
    return statements;
  }
  /** Binds the parameters of an iterator to their live fields; captured ones move into cells when the machine starts. */
  hoistParameters(parameters, liveFields) {
    const hoist = this.frame.hoist,
      prologue = [];
    parameters.forEach((symbol, i) => {
      const live = () => n.field(hoist.self(), liveFields[i]);
      if (!this.frame.captures.isCaptured(symbol)) this.frame.vars.set(symbol, live);
      else prologue.push(...this.hoistVariable(symbol, live()));
    });
    return prologue;
  }
  /**
   * A statement-level temporary that outlives the expression that fills it (an enumerator, a chosen switch section):
   * a hidden local, or in a state machine a hoisted field. Returns `{read(), init(value, syntax)}`.
   */
  holder(type, hint) {
    const hoist = this.frame.hoist;
    if (!hoist) {
      const variable = this.addBlockLocal(this.temp(type, hint));
      return { read: () => n.local(variable), init: (value, syntax = n.hidden) => n.declare([[variable, value]], syntax) };
    }
    const slot = this.g.iterators.addField(hoist.info, hoist.machine, hoistedSynthesizedLocalFieldName(++hoist.slots), type),
      read = () => n.field(hoist.self(), slot);
    return { read, init: (value, syntax = n.hidden) => n.expressionStatement(n.assign(read(), value), syntax) };
  }
  /** Declares a variable introduced inside an expression (pattern or out variable): created before the statement. */
  declarePending(symbol) {
    if (this.frame.vars.has(symbol)) return;
    const type = this.imageType(symbol.type, symbol.syntax);
    this.pending.push(...this.declareVariable(symbol, this.defaultValue(type)));
  }
  /** Binds the parameters of the method being translated, moving captured ones into cells. */
  declareParameters(parameters, firstOrdinal = 0) {
    const prologue = [];
    parameters.forEach((symbol, i) => {
      const type = this.imageType(symbol.type, symbol.syntax),
        slot = n.newParameter(symbol.name, type, firstOrdinal + i);
      if (!this.frame.captures.isCaptured(symbol)) {
        this.frame.vars.set(symbol, () => n.parameter(slot));
        return;
      }
      const cell = this.g.cellClass(type),
        holder = this.addBlockLocal(this.temp(cell.record.name, symbol.name));
      this.frame.cells.set(symbol, () => n.local(holder));
      this.frame.vars.set(symbol, () => n.field(n.local(holder), cell.value));
      prologue.push(
        n.declare([[holder, n.allocate(cell.record)]]),
        n.expressionStatement(n.assign(n.field(n.local(holder), cell.value), n.parameter(slot))),
      );
    });
    return prologue;
  }
  variable(symbol, syntax) {
    const access = this.frame.vars.get(symbol);
    return access ? access() : this.unsupported(`variable '${symbol.name}' in this position`, syntax);
  }
  defaultValue(type) {
    return n.literal(type === 'int' || type === 'double' ? 0 : type === 'bool' ? false : null, type);
  }
  /**
   * Evaluates `value` once: returns `{read, effects, locals}` where `read()` yields the value any number of times.
   * Locals, parameters, `this` and literals are read directly.
   */
  once(value, hint = 'v') {
    if (['Local', 'Parameter', 'ThisReference', 'Literal'].includes(value.kind)) return { read: () => value, effects: [], locals: [] };
    const temp = this.temp(value.legacyType, hint);
    return { read: () => n.local(temp), effects: [n.assign(n.local(temp), value)], locals: [temp] };
  }
  // ---- bodies ----
  /** Lowers a whole method body (a Block, an expression body or a bare expression of a lambda). */
  body(bound, { prologue = [], returnsValue = true } = {}) {
    const statements = [...prologue];
    if (bound.kind === 'Block') statements.push(this.statement(bound));
    else if (bound.kind === 'ExpressionBody') statements.push(this.expressionBody(bound.expression, bound.isReturn, bound.syntax));
    else statements.push(this.expressionBody(bound, returnsValue, bound.syntax));
    return n.block(statements, this.scopes[0]);
  }
  expressionBody(expression, isReturn, syntax) {
    const span = this.span(syntax);
    const value = isReturn ? this.expression(expression) : this.effect(expression);
    const statement = isReturn ? n.returnStatement(value, span) : n.expressionStatement(value, span);
    return this.withPending(statement);
  }
  /** Wraps a statement with the declarations of the variables its expressions introduced. */
  withPending(statement) {
    if (!this.pending.length) return statement;
    const declarations = this.pending;
    this.pending = [];
    return n.block([...declarations, statement]);
  }
}

/** Construct families, innermost first: a later mixin refines the ones before it. */
const families = [
  ExpressionTranslation,
  CallTranslation,
  FunctionTranslation,
  PatternTranslation,
  StatementTranslation,
  JumpTranslation,
  RuntimeGapTranslation,
  ArrayTranslation,
  AwaitTranslation,
  AsyncStreamTranslation,
  ByReferenceTranslation,
  Locations,
  TupleTranslation,
  SynthesizedTextTranslation,
  DeconstructionTranslation,
  ...memberLowerings,
  InitializerLowering,
  RecordTranslation,
  StructuralPatternTranslation,
  ...languageLowerings,
  // Last: what depends on a type argument is decided before any other family sees the node.
  ScalarTranslation,
  GenericTranslation,
];

export class BodyTranslator extends families.reduce(
  (composed, mixin) => mixin(composed),
  TranslatorCore,
) {}
