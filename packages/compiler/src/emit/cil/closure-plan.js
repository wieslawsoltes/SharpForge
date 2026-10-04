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
import { MethodAttributes, FieldAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { NamedTypeSymbol, TypeKind, Accessibility, SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { analyzeCaptures } from '../../lowering/closures.js';
import { parameterFlags } from '../../codegen/metadata/attribute-flags.js';
import { IlBuilder } from './il-builder.js';
import { MethodEmitter } from './method-emitter.js';
import { UnsupportedInCil } from './unsupported.js';

const CONSTRUCTOR_FLAGS =
  MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName;
const CLOSURE_METHOD_FLAGS = MethodAttributes.Assembly | MethodAttributes.HideBySig;
const OWNER_METHOD_FLAGS = MethodAttributes.Private | MethodAttributes.HideBySig;
const THIS_FIELD_NAME = '<>4__this';

/** `ldarg.0; call object::.ctor(); ret` */
function objectConstructorBody(program) {
  const core = program.core,
    shape = { isStatic: false, returnType: core.void, parameters: [] },
    il = new IlBuilder();
  il.emit('ldarg', 0).emit('call', program.tokens.external(core.object, '.ctor', shape), { pops: 1, pushes: 0 });
  return il.emit('ret', undefined, { pops: 0, pushes: 0 });
}

export class ClosurePlan {
  /** @param analysis a SemanticAnalysis that has run without errors */
  constructor(analysis) {
    this.core = analysis.core;
    /** Lambda node or local function symbol -> its plan. */
    this.functions = new Map();
    /** Variable symbol -> the cell class it lives in. */
    this.cells = new Map();
    /** Synthesized type symbols, in the order they get their TypeDef rows. */
    this.types = [];
    /** Type symbol (source or synthesized) -> the fields and methods synthesized into it. */
    this.additions = new Map();
    this.cellClasses = new Map();
    this.ordinals = new Map();
  }
  isCaptured(variable) {
    return this.cells.has(variable);
  }
  /**
   * Plans the functions of one bound body.
   * @param root a bound body, initializer or constructor initializer call
   * @param {{owner: object, name: string, uri: string|null, isGenericMethod?: boolean}} context the containing type,
   *   the name of the member the body belongs to, and its file
   */
  planRoot(root, context) {
    const captures = analyzeCaptures(root, { byReferenceInCells: false });
    if (!captures.functions.size) return;
    if (context.owner.isGenericType || context.isGenericMethod) {
      const first = captures.functions.keys().next().value;
      throw new UnsupportedInCil('lambdas and local functions in generic types or methods', first.syntax ?? null, context.uri);
    }
    for (const variable of captures.captured) this.cells.set(variable, this.cellClass(context.owner, variable.type));
    for (const [key, functionCaptures] of captures.functions) this.planFunction(key, functionCaptures, context);
  }
  additionsTo(type) {
    let entry = this.additions.get(type);
    if (!entry) {
      entry = { fields: [], methods: [] };
      this.additions.set(type, entry);
    }
    return entry;
  }
  nextOrdinal(owner) {
    const ordinal = this.ordinals.get(owner) ?? 0;
    this.ordinals.set(owner, ordinal + 1);
    return ordinal;
  }
  /** A synthesized class nested in `owner`, with a public parameterless constructor. */
  nestedClass(owner, name) {
    const core = this.core,
      type = new NamedTypeSymbol({
        name,
        typeKind: TypeKind.Class,
        containingSymbol: owner,
        declaredAccessibility: Accessibility.Private,
        baseType: () => core.object,
        isSealed: true,
        isImplicitlyDeclared: true,
      }),
      constructor = {
        symbol: null,
        name: '.ctor',
        flags: CONSTRUCTOR_FLAGS,
        implFlags: MethodImplAttributes.IL,
        hasBody: true,
        isCompilerGenerated: true,
        shape: { isStatic: false, returnType: core.void, parameters: [] },
        parameters: [],
        emitBody: objectConstructorBody,
      };
    type.isSource = true;
    this.types.push(type);
    this.additionsTo(type).methods.push(constructor);
    return { type, constructor };
  }
  field(type, name, fieldType) {
    const field = { symbol: null, name, flags: FieldAttributes.Public, type: fieldType, constant: null, isCompilerGenerated: true };
    this.additionsTo(type).fields.push(field);
    return field;
  }
  /** The cell class of `owner` for variables of `valueType`: `{type, constructor, value}`. */
  cellClass(owner, valueType) {
    let classes = this.cellClasses.get(owner);
    if (!classes) this.cellClasses.set(owner, (classes = []));
    let cell = classes.find(candidate => candidate.valueType.equals(valueType));
    if (!cell) {
      const { type, constructor } = this.nestedClass(owner, `<>Cell_${classes.length}`);
      cell = { type, constructor, valueType, value: this.field(type, 'Value', valueType) };
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
      returnType = isLambda ? invoke?.returnType : symbol.returnType;
    if (symbol?.typeParameters?.length) throw new UnsupportedInCil('generic local functions', symbol.locations?.[0] ?? null, uri);
    let closure = null;
    if (variables.length) {
      const { type, constructor } = this.nestedClass(owner, `<>c__DisplayClass${ordinal}`);
      closure = {
        type,
        constructor,
        fields: new Map(variables.map(variable => [variable, this.field(type, variable.name, this.cells.get(variable).type)])),
        thisField: captures.usesThis ? this.field(type, THIS_FIELD_NAME, owner) : null,
      };
    }
    const isStatic = !closure && !captures.usesThis,
      plan = { key, isLambda, symbol, owner, uri, variables, usesThis: captures.usesThis, closure, isStatic, parameters, returnType };
    plan.body = isLambda ? key.body : symbol.body;
    plan.method = {
      symbol: null,
      name: isLambda ? `<${name}>b__${ordinal}` : `<${name}>g__${symbol.name}|${ordinal}`,
      flags: closure ? CLOSURE_METHOD_FLAGS : OWNER_METHOD_FLAGS | (isStatic ? MethodAttributes.Static : 0),
      implFlags: MethodImplAttributes.IL,
      hasBody: true,
      isCompilerGenerated: true,
      shape: returnType
        ? { isStatic, returnType, parameters: parameters.map(parameter => ({ type: parameter.type, refKind: parameter.refKind })) }
        : null,
      parameters: parameters.map(parameter => ({ name: parameter.name, flags: parameterFlags(parameter) })),
      emitBody: program => this.functionBody(program, plan),
    };
    if (!plan.method.shape) throw new UnsupportedInCil('a lambda that is not converted to a delegate type', key.syntax ?? null, uri);
    this.additionsTo(closure ? closure.type : owner).methods.push(plan.method);
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
    if (plan.body?.binder?.c?.isIterator) emitter.unsupported('iterator local functions', plan.key.syntax);
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
      context = { owner: key.containingType, name, uri, isGenericMethod: isMethod && !!key.typeParameters?.length };
    plan.planRoot(body, context);
    if (isMethod && key.initializerCall) plan.planRoot(key.initializerCall, context);
  }
  return plan;
}
