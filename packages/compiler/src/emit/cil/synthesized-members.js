/**
 * What code generation declares beyond the program's own symbols (SF-A02-T30), as additions to the member plan of the
 * metadata writer (codegen/metadata/member-plan.js):
 *
 *   Program.<Main>$   the entry point that holds the top-level statements (and `Program` itself when not declared)
 *   .cctor            for a type with static field initializers and no static constructor of its own
 *
 * A synthesized method is a planned entry without a symbol whose `emitBody(program)` returns its instruction stream.
 */
import { MethodAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { walk } from '../../bound/semantic-walker.js';
import { sourceTypesInMetadataOrder } from '../../codegen/metadata/symbol-metadata.js';
import { MethodEmitter } from './method-emitter.js';
import { planClosures } from './closure-plan.js';
import { planStateMachines } from './state-machine-plan.js';
import { completeFieldLikeEvent } from './synthesized-events.js';
import { planPrimaryCaptures } from './primary-constructor-captures.js';
import { asyncEntryPoint } from './async-members.js';

const ENTRY_FLAGS = MethodAttributes.Private | MethodAttributes.Static | MethodAttributes.HideBySig;
const TYPE_INITIALIZER_FLAGS = ENTRY_FLAGS | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName;
const TOP_LEVEL_ENTRY_NAME = '<Main>$';
/** Functions nested in a body have returns of their own. */
const nestedFunctions = new Set(['Lambda', 'LocalFunction']);

/** True when the top-level statements return a value: the entry point then returns `int`. */
function returnsExitCode(body) {
  let found = false;
  walk(body, node => {
    if (node.kind === 'Return' && node.expression) found = true;
    return !found && !nestedFunctions.has(node.kind);
  });
  return found;
}

export class SynthesizedMembers {
  /** @param analysis a SemanticAnalysis that has run without errors */
  constructor(analysis) {
    this.analysis = analysis;
    this.core = analysis.core;
    const topLevel = [...analysis.bound].find(([key]) => key?.syntax && key.source && !key.kind) ?? null,
      programType = topLevel ? analysis.programType : null,
      declared = sourceTypesInMetadataOrder(analysis.assembly);
    this.topLevel = topLevel ? this.topLevelProgram(topLevel[0], topLevel[1], programType) : null;
    this.closures = planClosures(analysis, this.topLevel);
    this.primaryCaptures = planPrimaryCaptures(analysis);
    this.stateMachines = planStateMachines(analysis, this.closures, this.topLevel?.isAsync ? this.topLevelKickoff() : null);
    const ownProgram = programType && !declared.includes(programType) ? [programType] : [];
    /** Types to append after the source types. State machine classes come last: their field lists grow while bodies are emitted. */
    this.types = [...ownProgram, ...this.closures.types, ...this.stateMachines.types];
    /** The planned entry of the synthesized entry point, once `extend` has seen its type. */
    this.entryPoint = null;
    /** Async `Main` method symbol -> the planned `<Main>` that runs it, once `extend` has seen its type. */
    this.asyncEntryPoints = new Map();
  }
  /** The top-level statements as a method: `void`, `int`, or - when they await - `Task` or `Task<int>`. */
  topLevelProgram(file, body, type) {
    const core = this.core,
      isAsync = !!body.binder?.c?.isAsync,
      result = returnsExitCode(body) ? core.int : core.void,
      returnType = !isAsync ? result : result === core.int ? core.taskT.construct(core.int) : core.task;
    return { file, body, type, isAsync, returnType, parameters: body.binder?.c?.parameters ?? [] };
  }
  topLevelKickoff() {
    const { file, body, type, returnType, parameters } = this.topLevel;
    return { key: body, owner: type, uri: file.source.uri, parameters, returnType, body };
  }
  /** Adds the synthesized members of one type to its plan. */
  extend(type, plan) {
    if (this.topLevel?.type === type) {
      const statements = this.topLevelEntry(type);
      plan.methods.push(statements);
      this.entryPoint = statements;
      if (this.topLevel.isAsync) {
        this.entryPoint = asyncEntryPoint(this.core, statements.shape, () => statements.token);
        plan.methods.push(this.entryPoint);
      }
    }
    for (const method of [...plan.methods]) {
      const symbol = method.symbol;
      if (!symbol?.isAsync || !isEntryPointMethod(symbol)) continue;
      const shape = { isStatic: true, returnType: symbol.returnType, parameters: symbol.parameters.map(parameter => ({ type: parameter.type })) },
        entry = asyncEntryPoint(this.core, shape, () => method.token);
      this.asyncEntryPoints.set(symbol, entry);
      plan.methods.push(entry);
    }
    const declaresTypeInitializer = plan.methods.some(method => method.name === '.cctor');
    if (!declaresTypeInitializer && this.hasStaticInitializers(type)) plan.methods.push(this.typeInitializer(type));
    for (const event of plan.events) completeFieldLikeEvent(type, event, plan);
    plan.fields.push(...(this.primaryCaptures.byType.get(type) ?? []));
    for (const additions of [this.closures.additions.get(type), this.stateMachines.additions.get(type)]) {
      if (!additions) continue;
      plan.fields.push(...additions.fields);
      plan.methods.push(...additions.methods);
    }
  }
  hasStaticInitializers(type) {
    return type.getMembers().some(member => {
      const initialized = member.kind === SymbolKind.Field || member.kind === SymbolKind.Property || member.kind === SymbolKind.Event;
      return initialized && member.isStatic && !member.isConst && this.analysis.bound.has(member);
    });
  }
  topLevelEntry(type) {
    const { file, body, parameters, returnType } = this.topLevel;
    return {
      symbol: null,
      name: TOP_LEVEL_ENTRY_NAME,
      flags: ENTRY_FLAGS,
      implFlags: MethodImplAttributes.IL,
      hasBody: true,
      isCompilerGenerated: true,
      shape: { isStatic: true, returnType, parameters: parameters.map(parameter => ({ type: parameter.type })) },
      parameters: parameters.map(parameter => ({ name: parameter.name, flags: 0 })),
      emitBody: program => {
        const frame = { uri: file.source.uri, containingType: type, isStatic: true, parameters, returnType, method: null };
        const emitter = new MethodEmitter(program, frame),
          machine = program.stateMachines.of(body);
        if (!machine) return emitter.body(body, () => emitter.moduleInitializers());
        emitter.moduleInitializers();
        return emitter.kickoffBody(machine);
      },
    };
  }
  typeInitializer(type) {
    const core = this.core;
    return {
      symbol: null,
      name: '.cctor',
      flags: TYPE_INITIALIZER_FLAGS,
      implFlags: MethodImplAttributes.IL,
      hasBody: true,
      isInitializerOnly: true,
      shape: { isStatic: true, returnType: core.void, parameters: [] },
      parameters: [],
      emitBody: program => {
        const frame = { uri: null, containingType: type, isStatic: true, parameters: [], returnType: core.void, method: null };
        return new MethodEmitter(program, frame).body(null, emitter => emitter.staticInitializers(type));
      },
    };
  }
}

const TASK_NAMESPACE = 'System.Threading.Tasks';

/** True for `Task` and `Task<int>`, what an async `Main` may return. */
function isEntryPointTask(type) {
  const definition = type?.originalDefinition ?? type;
  if (definition?.name !== 'Task' || definition.containingSymbol?.qualifiedName !== TASK_NAMESPACE) return false;
  return !definition.arity || type.typeArguments[0].type?.specialType === 'System_Int32';
}

/**
 * True for a static method shaped like an entry point: `Main`, no parameters or `string[]`, returning void or int -
 * or, for an async `Main`, `Task` or `Task<int>`.
 */
export function isEntryPointMethod(method) {
  if (!method.isStatic || method.methodKind !== MethodKind.Ordinary || method.name !== 'Main' || method.typeParameters?.length) return false;
  const parameters = method.parameters,
    takesArguments = parameters.length === 1 && parameters[0].type?.elementType?.specialType === 'System_String' && parameters[0].type.rank === 1;
  if (parameters.length && !takesArguments) return false;
  return ['System_Void', 'System_Int32'].includes(method.returnType?.specialType) || isEntryPointTask(method.returnType);
}
