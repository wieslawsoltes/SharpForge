/**
 * Closure conversion, declaration half (SF-A02-T30): what the lambdas and local functions of a compilation become
 * in metadata. It runs before tokens are allocated, because every synthesized type and member needs one.
 *
 *   captured variable   lives in a heap cell `<>Cell_N { T Value; }` created where the variable is declared, so a
 *                       variable declared in a loop body gets a fresh cell per iteration, as C# requires
 *   function            a lambda or local function: a method `<M>b__N` / `<M>g__Name|N`
 *     no captures       static, in the containing type
 *     only `this`       an instance method of the containing type
 *     variables         an instance method of a closure class `<>c__DisplayClassN` whose fields hold the cells it
 *                       uses (and `<>4__this`); creating the delegate, or calling the local function, fills one
 *
 * The capture analysis itself is lowering/closures.js. Synthesized types are nested in the containing type, so that
 * their code may use its private members.
 */
import { MethodAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { walk } from '../../bound/semantic-walker.js';
import { SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { analyzeCaptures } from '../../lowering/closures.js';
import { parameterFlags } from '../../codegen/metadata/attribute-flags.js';
import { SynthesizedTypes } from './synthesized-types.js';
import { MethodEmitter } from './method-emitter.js';
import { UnsupportedInCil } from './unsupported.js';
import { methodTypeParameterCopies, substitutionOver } from './generic-context.js';
import { closureScopes } from './closure-scopes.js';
import { expressionTreeDelegate } from '../../symbols/expression-tree-types.js';

const CLOSURE_METHOD_FLAGS = MethodAttributes.Assembly | MethodAttributes.HideBySig;
const OWNER_METHOD_FLAGS = MethodAttributes.Private | MethodAttributes.HideBySig;
const THIS_FIELD_NAME = '<>4__this';

export class ClosurePlan extends SynthesizedTypes {
  /** @param analysis a SemanticAnalysis that has run without errors */
  constructor(analysis) {
    super(analysis.core);
    /** Lambda node or local function symbol -> its plan. */
    this.functions = new Map();
    /** Variable symbol -> the cell class it lives in. */
    this.cells = new Map();
    this.cellClasses = new Map();
    this.ordinals = new Map();
  }
  isCaptured(variable) {
    return this.cells.has(variable);
  }
  /**
   * Plans the functions of one bound body.
   * @param root a bound body, initializer or constructor initializer call
   * @param {{owner: object, name: string, uri: string|null, typeParameters?: object[]}} context the containing type,
   *   the name of the member the body belongs to, its file, and the type parameters of a generic method
   */
  planRoot(root, context) {
    const captures = analyzeCaptures(root, { byReferenceInCells: false });
    if (!captures.functions.size) return;
    context.typeParameters ??= [];
    const scopes = closureScopes(root, context, captures);
    for (const variable of captures.captured) this.cells.set(variable, this.cellClass(scopes.ofVariable.get(variable) ?? context, variable.type));
    // A lambda converted to an expression tree is data, not code: neither it nor the lambdas inside it become methods.
    const insideTrees = new Set();
    for (const key of captures.functions.keys()) {
      if (key.kind !== 'Lambda' || !expressionTreeDelegate(key.boundAs, this.core)) continue;
      insideTrees.add(key);
      walk(key.body, node => {
        if (node.kind === 'Lambda') insideTrees.add(node);
        return true;
      });
    }
    for (const [key, functionCaptures] of captures.functions) {
      if (!insideTrees.has(key)) this.planFunction(key, functionCaptures, scopes.ofFunction.get(key) ?? context);
    }
  }
  nextOrdinal(owner) {
    const ordinal = this.ordinals.get(owner) ?? 0;
    this.ordinals.set(owner, ordinal + 1);
    return ordinal;
  }
  /**
   * The cell class for variables of `valueType` declared in the body `context` describes: `{type, constructor, value}`.
   * In a generic method the class is generic over the method's type parameters, so one method's cells are its own.
   */
  cellClass(context, valueType) {
    const { owner, typeParameters } = context;
    let classes = this.cellClasses.get(owner);
    if (!classes) this.cellClasses.set(owner, (classes = []));
    const sameScope = candidate => candidate.typeParameters === typeParameters || !(candidate.typeParameters.length + typeParameters.length);
    let cell = classes.find(candidate => sameScope(candidate) && candidate.valueType.equals(valueType));
    if (!cell) {
      const { type, definition, constructor } = this.nestedClass(owner, `<>Cell_${classes.length}`, { typeParameters });
      cell = { type, constructor, valueType, typeParameters, value: this.field(definition, 'Value', valueType) };
      classes.push(cell);
    }
    return cell;
  }
  planFunction(key, captures, context) {
    const { owner, name, uri } = context,
      isLambda = key.kind === 'Lambda',
      symbol = isLambda ? null : key,
      ordinal = this.nextOrdinal(owner),
      variables = [...captures.variables],
      invoke = isLambda ? key.boundAs?.delegateInvokeMethod : null,
      // `delegate { ... }` without a parameter list fits any signature: the method takes the delegate's parameters.
      takesDelegateParameters = isLambda && key.isAnonymousMethod && !key.parameterSyntax && !!invoke,
      parameters = (takesDelegateParameters ? invoke.parameters : isLambda ? key.parameters : symbol.parameters) ?? [],
      returnType = isLambda ? invoke?.returnType : symbol.returnType,
      // A lambda returns by reference when its delegate does (`delegate ref int Selector(int[] items)`).
      returnRefKind = (isLambda ? invoke?.refKind : symbol.refKind) ?? null;
    const body = isLambda ? key.body : symbol.body,
      ownTypeParameters = symbol?.typeParameters ?? [];
    let closure = null;
    if (variables.length) {
      const { type, definition, constructor } = this.nestedClass(owner, `<>c__DisplayClass${ordinal}`, { typeParameters: context.typeParameters });
      closure = {
        type,
        definition,
        constructor,
        fields: new Map(variables.map(variable => [variable, this.field(definition, variable.name, this.cells.get(variable).type)])),
        thisField: captures.usesThis ? this.field(definition, THIS_FIELD_NAME, owner) : null,
      };
    }
    // A method of the containing type is generic over the type parameters in scope; a method of a closure class finds
    // those of the enclosing method on its class and declares only its own.
    const isStatic = !closure && !captures.usesThis,
      scope = closure ? [] : context.typeParameters,
      declared = [...scope, ...ownTypeParameters],
      typeParameters = methodTypeParameterCopies(declared),
      plan = { key, isLambda, symbol, owner, uri, variables, usesThis: captures.usesThis, closure, isStatic, parameters, returnType, returnRefKind };
    plan.body = body;
    /** The type the method is declared in, and the type arguments a use supplies before those of the function itself. */
    plan.declaringType = closure ? closure.definition : owner;
    plan.scopeTypeArguments = scope;
    plan.contextTypeParameters = context.typeParameters;
    plan.method = {
      symbol: null,
      name: isLambda ? `<${name}>b__${ordinal}` : `<${name}>g__${symbol.name}|${ordinal}`,
      flags: closure ? CLOSURE_METHOD_FLAGS : OWNER_METHOD_FLAGS | (isStatic ? MethodAttributes.Static : 0),
      implFlags: MethodImplAttributes.IL,
      hasBody: true,
      isCompilerGenerated: true,
      shape: returnType
        ? {
            isStatic,
            arity: typeParameters.length,
            returnType,
            refKind: returnRefKind,
            parameters: parameters.map(parameter => ({ type: parameter.type, refKind: parameter.refKind })),
          }
        : null,
      typeParameters,
      substitution: substitutionOver(declared, typeParameters, closure?.definition.typeSubstitution ?? null),
      parameters: parameters.map(parameter => ({ name: parameter.name, flags: parameterFlags(parameter) })),
      emitBody: program => this.functionBody(program, plan),
    };
    if (!plan.method.shape) throw new UnsupportedInCil('a lambda that is not converted to a delegate type', key.syntax ?? null, uri);
    this.additionsTo(plan.declaringType).methods.push(plan.method);
    this.functions.set(key, plan);
  }
  functionBody(program, plan) {
    const emitter = new MethodEmitter(program, {
      uri: plan.uri,
      containingType: plan.owner,
      isStatic: plan.isStatic,
      parameters: plan.parameters,
      returnType: plan.returnType,
      method: plan.symbol,
      function: plan,
    });
    const machine = program.stateMachines.of(plan);
    if (machine) return emitter.kickoffBody(machine);
    if (plan.isLambda ? plan.key.isAsync : plan.symbol.isAsync) emitter.unsupported('async lambdas and local functions', plan.key.syntax);
    return emitter.body(plan.body);
  }
}

/**
 * Plans every function of an analysed compilation.
 * @param analysis a SemanticAnalysis that has run without errors
 * @param {{file: object, body: object, type: object}|null} topLevel the top-level statements, when there are any
 * @returns {ClosurePlan}
 */
export function planClosures(analysis, topLevel) {
  const plan = new ClosurePlan(analysis);
  for (const [key, body] of analysis.bound) {
    if (topLevel && body === topLevel.body) {
      plan.planRoot(body, { owner: topLevel.type, name: 'Main', uri: topLevel.file.source.uri });
      continue;
    }
    if (!key?.containingType || key.methodKind === MethodKind.LocalFunction) continue;
    const isMethod = key.kind === SymbolKind.Method,
      uri = key.uri ?? key.locations?.[0]?.uri ?? null,
      name = isMethod ? key.name : key.isStatic ? '.cctor' : '.ctor',
      context = { owner: key.containingType, name, uri, typeParameters: isMethod ? (key.typeParameters ?? []) : [] };
    plan.planRoot(body, context);
    if (isMethod && key.initializerCall) plan.planRoot(key.initializerCall, context);
  }
  return plan;
}
