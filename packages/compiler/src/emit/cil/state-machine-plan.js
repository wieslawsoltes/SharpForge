/**
 * State machines, declaration half (SF-A02-T30): the class an iterator becomes. It runs before tokens are allocated,
 * after closure conversion (a lambda or local function can be an iterator too).
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

const FIELD_TABLE = 4;
const STATE_FIELD_NAME = '<>1__state';
const THIS_FIELD_NAME = '<>4__this';

/** One state machine: its class, its fixed fields and the kickoff it was made from. */
export class StateMachine {
  constructor(kind, kickoff, type) {
    /** 'iterator' */
    this.kind = kind;
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
    const plan = program.tokens.writer.plans.get(this.type),
      field = { symbol: null, name, flags: FieldAttributes.Private, type, constant: null, isCompilerGenerated: true };
    field.token = token(FIELD_TABLE, plan.fieldStart + plan.fields.length);
    plan.fields.push(field);
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
  /** Plans the state machine of one kickoff when its body is an iterator. */
  plan(kickoff) {
    const context = kickoff.body?.binder?.c;
    if (!context?.isIterator) return;
    if (kickoff.isAsync) throw new UnsupportedInCil('async iterators', kickoff.syntax, kickoff.uri);
    if (kickoff.owner.isGenericType || kickoff.isGeneric) {
      throw new UnsupportedInCil('iterators in generic types or methods', kickoff.syntax, kickoff.uri);
    }
    const shape = iteratorShapeOf(kickoff.returnType, this.core);
    if (!shape) throw new UnsupportedInCil(`an iterator returning '${kickoff.returnType.toDisplayString()}'`, kickoff.syntax, kickoff.uri);
    const name = `<${kickoff.name}>d__${this.closures.nextOrdinal(kickoff.owner)}`,
      { type } = this.nestedClass(kickoff.owner, name, { interfaces: shape.interfaces, hasDefaultConstructor: false }),
      machine = new StateMachine('iterator', kickoff, type);
    machine.fields.state = this.field(type, STATE_FIELD_NAME, this.core.int);
    declareIterator(this, machine, shape);
    if (kickoff.receiverType) machine.fields.receiver = this.field(type, THIS_FIELD_NAME, kickoff.receiverType);
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
    isGeneric: !!method.typeParameters?.length,
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
    name: plan.method.name.replace(/[<>|]/g, '_'),
    uri: plan.uri,
    syntax: plan.key.syntax ?? plan.symbol?.locations?.[0] ?? null,
    isStatic: plan.isStatic,
    isAsync: plan.isLambda ? !!plan.key.isAsync : !!plan.symbol.isAsync,
    isGeneric: false,
    parameters: plan.parameters,
    returnType: plan.returnType,
    body: plan.body,
    receiverType,
    function: plan,
    method: plan.symbol,
  };
}

/**
 * Plans the state machine of every iterator of an analysed compilation.
 * @param analysis a SemanticAnalysis that has run without errors  @param closures its ClosurePlan
 * @returns {StateMachinePlan}
 */
export function planStateMachines(analysis, closures) {
  const plan = new StateMachinePlan(analysis, closures);
  for (const [key, body] of analysis.bound) {
    if (key?.kind !== SymbolKind.Method || !key.containingType || key.methodKind === MethodKind.LocalFunction) continue;
    plan.plan(kickoffOfMethod(key, body, key.uri ?? key.locations?.[0]?.uri ?? null));
  }
  for (const functionPlan of closures.functions.values()) plan.plan(kickoffOfFunction(functionPlan));
  return plan;
}
