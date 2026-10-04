/**
 * State machines, declaration half (SF-A02-T30): the class an iterator or an async function becomes. It runs before
 * tokens are allocated, after closure conversion (a lambda or local function can be an iterator or async too).
 *
 *   kickoff      the method as the program declared it; its body only creates the state machine
 *   class        `<Name>d__N`, nested in the containing type, with the fields every machine has: `<>1__state`, the
 *                kickoff's parameters, `<>4__this` (the object the kickoff ran on) and what its kind adds
 *   MoveNext     the body of the kickoff, resumable at every suspension point (emit-state-machine.js)
 *
 * The locals that live across a suspension become fields only while `MoveNext` is emitted (state-machine-hoisting.js):
 * a state machine class is a type whose field list grows late (`lateFieldTypes`).
 */
import { FieldAttributes, token } from '@sharpforge/cil';
import { SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { SynthesizedTypes } from './synthesized-types.js';
import { UnsupportedInCil } from './unsupported.js';
import { declareIterator, iteratorShapeOf } from './iterator-members.js';
import { declareAsync, asyncStateMachineInterface } from './async-members.js';
import { asyncBuilderOf } from './async-builders.js';

const FIELD_TABLE = 4;
const STATE_FIELD_NAME = '<>1__state';
const THIS_FIELD_NAME = '<>4__this';

/** One state machine: its class, its fixed fields and the kickoff it was made from. */
export class StateMachine {
  /** @param type the class as code names it  @param definition its definition, the key of its members */
  constructor(kind, kickoff, type, definition) {
    /** 'iterator' or 'async' */
    this.kind = kind;
    this.definition = definition;
    /** `{key, owner, name, uri, isStatic, parameters, returnType, body, receiverType, function, method}` */
    this.kickoff = kickoff;
    this.type = type;
    this.instanceConstructor = null;
    this.moveNext = null;
    /** `state`, `receiver` (null for a static kickoff), then what the kind adds. */
    this.fields = { state: null, receiver: null };
    /** Parameter symbol -> `{field, initial}`; `initial` is the copy an enumerable keeps for its next enumerator. */
    this.parameters = new Map();
    this.hoistedCount = 0;
  }
  /**
   * Adds a field while `MoveNext` is emitted; it takes the next token of the class's field run.
   * @param program the AssemblyEmitter  @param {string} name  @param type the field type
   * @returns {{token: number}} the planned field
   */
  lateField(program, name, type) {
    const plan = program.tokens.writer.plans.get(this.definition),
      field = { symbol: null, name, flags: FieldAttributes.Private, type, constant: null, isCompilerGenerated: true };
    field.token = token(FIELD_TABLE, plan.fieldStart + plan.fields.length);
    plan.fields.push(field);
    program.synthesizedIndex.byToken = null;
    return field;
  }
}

export class StateMachinePlan extends SynthesizedTypes {
  /** @param analysis a SemanticAnalysis that has run without errors  @param closures the ClosurePlan of the compilation */
  constructor(analysis, closures) {
    super(analysis.core);
    this.closures = closures;
    /** Method symbol, or the plan of a lambda or local function -> its StateMachine. */
    this.machines = new Map();
  }
  /** The state machine a method symbol or a function plan is the kickoff of, or null for an ordinary method. */
  of(key) {
    return this.machines.get(key) ?? null;
  }
  /** Types whose field list grows while bodies are emitted; they are the last types of the assembly. */
  get lateFieldTypes() {
    return this.types;
  }
  /** Plans the state machine of one kickoff when its body is an iterator or async. */
  plan(kickoff) {
    const isIterator = !!kickoff.body?.binder?.c?.isIterator,
      refuse = construct => {
        throw new UnsupportedInCil(construct, kickoff.syntax, kickoff.uri);
      };
    if (!isIterator && !kickoff.isAsync) return;
    if (isIterator && kickoff.isAsync) refuse('async iterators');
    const returned = kickoff.returnType.toDisplayString(),
      shape = isIterator ? (iteratorShapeOf(kickoff.returnType, this.core) ?? refuse(`an iterator returning '${returned}'`)) : null,
      builder = isIterator ? null : (asyncBuilderOf(kickoff.returnType, this.core) ?? refuse(`an async method returning '${returned}'`)),
      name = `<${kickoff.name}>d__${this.closures.nextOrdinal(kickoff.owner)}`,
      interfaces = isIterator ? shape.interfaces : [asyncStateMachineInterface(this.core)],
      classOptions = { interfaces, hasDefaultConstructor: !isIterator, typeParameters: kickoff.typeParameters },
      { type, definition, constructor } = this.nestedClass(kickoff.owner, name, classOptions),
      machine = new StateMachine(isIterator ? 'iterator' : 'async', kickoff, type, definition);
    machine.instanceConstructor = constructor;
    machine.fields.state = this.field(definition, STATE_FIELD_NAME, this.core.int);
    if (isIterator) declareIterator(this, machine, shape);
    else declareAsync(this, machine, builder);
    if (kickoff.receiverType) machine.fields.receiver = this.field(definition, THIS_FIELD_NAME, kickoff.receiverType);
    this.machines.set(kickoff.key, machine);
  }
}

function kickoffOfMethod(method, body, uri) {
  return {
    key: method,
    owner: method.containingType,
    name: method.name,
    uri,
    syntax: method.locations?.[0] ?? null,
    isStatic: !!method.isStatic,
    isAsync: !!method.isAsync,
    typeParameters: method.typeParameters ?? [],
    parameters: method.parameters,
    returnType: method.returnType,
    body,
    receiverType: method.isStatic ? null : method.containingType,
    function: null,
    method,
  };
}

function kickoffOfFunction(plan) {
  const receiverType = plan.closure ? plan.closure.type : plan.isStatic ? null : plan.owner;
  return {
    key: plan,
    owner: plan.owner,
    name: plan.method.name,
    uri: plan.uri,
    syntax: plan.key.syntax ?? plan.symbol?.locations?.[0] ?? null,
    isStatic: plan.isStatic,
    isAsync: plan.isLambda ? !!plan.key.isAsync : !!plan.symbol.isAsync,
    typeParameters: [...plan.contextTypeParameters, ...(plan.symbol?.typeParameters ?? [])],
    parameters: plan.parameters,
    returnType: plan.returnType,
    body: plan.body,
    receiverType,
    function: plan,
    method: plan.symbol,
  };
}

/**
 * Plans the state machine of every iterator and async function of an analysed compilation.
 * @param analysis a SemanticAnalysis that has run without errors  @param closures its ClosurePlan
 * @param {object|null} topLevel the kickoff of async top-level statements (`{key, owner, parameters, returnType, body, uri}`)
 * @returns {StateMachinePlan}
 */
export function planStateMachines(analysis, closures, topLevel = null) {
  const plan = new StateMachinePlan(analysis, closures);
  if (topLevel) {
    const statements = { name: '<Main>$', syntax: null, isStatic: true, isAsync: true, typeParameters: [] };
    plan.plan({ ...topLevel, ...statements, receiverType: null, function: null, method: null });
  }
  for (const [key, body] of analysis.bound) {
    if (key?.kind !== SymbolKind.Method || !key.containingType || key.methodKind === MethodKind.LocalFunction) continue;
    plan.plan(kickoffOfMethod(key, body, key.uri ?? key.locations?.[0]?.uri ?? null));
  }
  for (const functionPlan of closures.functions.values()) plan.plan(kickoffOfFunction(functionPlan));
  return plan;
}
