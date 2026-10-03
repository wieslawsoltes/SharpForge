/**
 * Code generation from semantic bound trees (SF-A02-E02): a whole analysed program is lowered to the constructs the
 * bytecode IR already has - classes with fields, statically bound calls, branches - and emitted through the IR
 * emitter of the execution profile, so the image runs on both back ends unchanged.
 *
 *   closures           -> display classes over heap cells           (lowering/closures.js, translate-functions.js)
 *   delegates          -> a class per delegate type, numbered targets (delegates.js)
 *   patterns, switches -> sequential tests over shared evaluations   (lowering/decision-dag.js, translate-patterns.js)
 *   initialization     -> initializer methods run where .NET runs them (initialization.js)
 *
 * A construct that needs an instruction the runtime does not have raises `UnsupportedConstruct`; the generator then
 * produces no image and names the construct, which `compile()` reports as SF2200.
 */
import { frameworkBridge } from '../../symbols/registry-bridge.js';
import { MethodKind } from '../../symbols/members.js';
import { isSourceSymbol } from '../../semantic/analysis-helpers.js';
import { analyzeCaptures } from '../../lowering/closures.js';
import { IteratorClasses, stateMachineBody } from '../../lowering/iterators.js';
import { newHoist } from '../../lowering/iterators/try-regions.js';
import { stateMachineTypeName, stateMachineParameterProxyFieldName, thisProxyFieldName } from '../../lowering/generated-names.js';
import { JumpIrEmitter } from './jump-emitter.js';
import { ProgramModel } from './program-model.js';
import { TypeMapper } from './type-mapper.js';
import { DelegateClasses } from './delegates.js';
import { Declarations } from './declarations.js';
import { Initialization } from './initialization.js';
import { BodyTranslator } from './body-translator.js';
import { Frame } from './frame.js';
import { UnsupportedConstruct } from './unsupported.js';
import { n } from './node-factory.js';

class GeneratorCore {
  /**
   * @param analysis the result of `SemanticAnalysis.run()` (assembly, bound bodies, core types)
   * @param {object[]} files the parsed files  @param {object} options compilation options (`name`)
   */
  constructor(analysis, files, options = {}) {
    this.analysis = analysis;
    this.files = files;
    this.program = new ProgramModel(new Map(files.map(f => [f.source.uri, f.source])), options.name ?? 'Application');
    this.bridge = frameworkBridge();
    this.types = new TypeMapper(this);
    this.delegates = new DelegateClasses(this);
    this.iterators = new IteratorClasses(this);
    this.classes = new Map();
    this.fields = new Map();
    this.methods = new Map();
    this.autoProperties = new Map();
    this.eventFields = new Map();
    this.paramsParameters = new Set();
    this.instanceInits = new Map();
    this.implicitConstructors = new Map();
    this.typeInits = new Map();
    this.typeInitializing = null;
    this.cells = new Map();
    this.queue = [];
    this.bodies = [];
    this.methodOrdinal = 0;
  }
  unsupported(construct, syntax = null, uri = null) {
    const error = new UnsupportedConstruct(construct, syntax);
    error.uri = uri ?? syntax?.uri ?? null;
    throw error;
  }
  isSource(symbol) {
    return isSourceSymbol(symbol);
  }
  uriOf(symbol) {
    return symbol.uri ?? symbol.locations?.[0]?.uri ?? this.files[0].source.uri;
  }
  delegateClassOf(type, syntax) {
    return this.delegates.classOf(type, syntax);
  }
  /** The heap cell class for captured variables of one image type: `{record, value}`. */
  cellClass(type) {
    let cell = this.cells.get(type);
    if (!cell) {
      const record = this.program.addClass(`<>Cell(${type})`);
      cell = { record, value: this.program.addField(record, 'Value', type) };
      this.cells.set(type, cell);
    }
    return cell;
  }
  fieldOf(symbol, syntax) {
    const definition = symbol.originalDefinition ?? symbol;
    const record = this.fields.get(definition);
    return record ?? this.unsupported(`field '${symbol.toDisplayString()}' (not in the framework registry)`, syntax);
  }
  eventFieldOf(symbol, syntax) {
    const record = this.eventFields.get(symbol.originalDefinition ?? symbol);
    return record ?? this.unsupported(`event '${symbol.toDisplayString()}' in this position`, syntax);
  }
  /** The accessors of a source property in the shape the IR emitter reads and writes properties through. */
  propertyOf(symbol, syntax) {
    const owner = this.classOf(symbol.containingType ?? symbol.containingSymbol, syntax);
    return {
      isStatic: symbol.isStatic,
      owner,
      get: symbol.getMethod ? this.methodOf(symbol.getMethod, syntax) : null,
      set: symbol.setMethod ? this.methodOf(symbol.setMethod, syntax) : null,
    };
  }
  queueBody(work) {
    this.queue.push(work);
  }
  addSynthesizedBody(method, body) {
    this.bodies.push({ method, body });
  }
  /** The frame for the body of a declared member (or of synthesized code that belongs to one). */
  memberFrame(method, symbol, uri, bound) {
    const captures = analyzeCaptures(bound);
    const root = { name: symbol?.name ?? 'Main', ordinal: this.methodOrdinal++, lambdas: 0, closures: 0, locals: 0, localFunctions: new Map() };
    const frame = new Frame({ uri, method, captures, root });
    if (!method.isStatic) frame.thisExpr = () => n.thisReference(method.owner.name);
    return frame;
  }
  /** Lowers one queued body and records it for emission. */
  translate({ frame, bound, parameters = [], returnsValue = true, prologue = null }) {
    const translator = new BodyTranslator(this, frame);
    const entry = translator.declareParameters(parameters);
    // `prologue(translator)` builds statements that run after the parameters are in place (a constructor initializer).
    if (prologue) entry.push(...prologue(translator));
    this.bodies.push({ method: frame.method, body: translator.body(bound, { prologue: entry, returnsValue }) });
  }
  drain() {
    while (this.queue.length) this.translate(this.queue.shift());
  }
}

/** Class mixin: bodies of declared members, the entry point and the startup method. */
const Members = Base =>
  class extends Base {
    translateMembers() {
      const bound = this.analysis.bound;
      for (const [symbol, record] of this.methods) {
        const body = bound.get(symbol);
        if (body) {
          if (body.binder?.isIterator || body.binder?.c?.isIterator) {
            this.translateIterator(symbol, record, body);
            this.drain();
            continue;
          }
          const frame = this.memberFrame(record, symbol, this.uriOf(symbol), body);
          this.queueBody({
            frame,
            bound: body,
            parameters: symbol.parameters,
            returnsValue: record.returnType !== 'void',
            prologue: this.prologueOf(symbol, frame),
          });
        } else this.synthesizeAccessor(symbol, record);
        this.drain();
      }
    }
    /**
     * An iterator method becomes a kickoff (the method itself: it creates the iterator object and stores the
     * arguments) and a state machine (`<M>d__N.MoveNext`) that runs the body with its locals hoisted into fields.
     */
    translateIterator(symbol, record, bound) {
      const at = symbol.locations?.[0],
        uri = this.uriOf(symbol),
        info = this.iterators.infoOf(record.returnType);
      if (!info) return this.unsupported('an iterator method that does not return IEnumerable<T> or IEnumerator<T>', at, uri);
      const frame = this.memberFrame(record, symbol, uri, bound),
        machine = this.iterators.addMachine(info, stateMachineTypeName(symbol.name, frame.root.ordinal)),
        self = () => n.parameter(n.newParameter('iterator', info.record.name, 0)),
        values = [];
      const proxy = (name, type, value) => {
        const isThis = name === 'this',
          initialName = isThis ? thisProxyFieldName() + 'initial' : stateMachineParameterProxyFieldName(name);
        const pair = {
          initial: this.iterators.addField(info, machine, initialName, type),
          live: this.iterators.addField(info, machine, isThis ? thisProxyFieldName() : name, type),
        };
        machine.proxies.push(pair);
        values.push(value);
        return pair.live;
      };
      const machineFrame = new Frame({ uri, method: machine.moveNext, captures: frame.captures, root: frame.root });
      machineFrame.hoist = newHoist(info, machine, self);
      if (!record.isStatic) {
        const live = proxy('this', record.owner.name, () => n.thisReference(record.owner.name));
        machineFrame.thisExpr = () => n.field(self(), live);
      }
      const liveParameters = symbol.parameters.map((p, i) => {
        const type = record.parameters[i].type;
        return proxy(p.name, type, () => n.parameter(n.newParameter(p.name, type, i)));
      });
      this.bodies.push({ method: record, body: n.block([n.returnStatement(this.iterators.create(info, machine, values))]) });
      const translator = new BodyTranslator(this, machineFrame),
        prologue = translator.hoistParameters(symbol.parameters, liveParameters),
        lowered = translator.statement(bound);
      this.bodies.push({ method: machine.moveNext, body: stateMachineBody(machineFrame.hoist, n.block([...prologue, lowered])) });
    }
    /** The accessors of an auto-property read and write its backing field. */
    synthesizeAccessor(symbol, record) {
      const property = symbol.associatedSymbol,
        field = property && this.autoProperties.get(property);
      if (!field) return this.unsupported(`'${symbol.toDisplayString()}' has no body`, symbol.locations?.[0], this.uriOf(symbol));
      const slot = () => (field.isStatic ? n.staticField(field) : n.field(n.thisReference(record.owner.name), field));
      const ensure = field.isStatic ? this.typeInitializerCall(property) : null,
        statements = ensure ? [n.expressionStatement(ensure)] : [];
      if (symbol.methodKind === MethodKind.PropertyGet) statements.push(n.returnStatement(slot()));
      else statements.push(n.expressionStatement(n.assign(slot(), n.parameter(n.newParameter('value', field.type, 0)))));
      this.addSynthesizedBody(record, n.block(statements));
    }
    /** `<startup>` calls the entry point; its result is the exit code. */
    startup(entry) {
      const method = this.program.addMethod(null, '<startup>', { isStatic: true, returnType: entry.returnType, parameters: [] });
      const args = entry.parameters.length ? [n.newArray('string', n.literal(0, 'int'))] : [];
      const invocation = n.call(entry, null, args);
      const statement = entry.returnType === 'void' ? n.expressionStatement(invocation) : n.returnStatement(invocation);
      this.bodies.push({ method, body: n.block([statement]) });
      return method;
    }
    /** The entry point: top-level statements, else the single static Main. */
    entryPoint() {
      const tops = [...this.analysis.bound].filter(([key]) => key?.syntax && key.source && !key.kind);
      if (tops.length > 1) return this.unsupported('top-level statements in several files');
      if (tops.length) {
        const [file, body] = tops[0];
        const method = this.program.addMethod(null, '<Main>', {
          isStatic: true,
          returnType: 'void',
          parameters: [{ name: 'args', type: 'string[]' }],
          node: { uri: file.source.uri, start: 0, end: file.source.length },
          hasSource: true,
        });
        const frame = this.memberFrame(method, { name: '<Main>$' }, file.source.uri, body);
        this.queueBody({ frame, bound: body, parameters: body.binder?.c?.parameters ?? [], returnsValue: false });
        this.drain();
        return method;
      }
      const mains = [...this.methods].filter(([symbol]) => symbol.name === 'Main' && isEntryPointCandidate(symbol));
      if (mains.length !== 1) return this.unsupported(mains.length ? 'several Main methods' : 'a program without an entry point');
      return mains[0][1];
    }
  };

export class SemanticGenerator extends Members(Initialization(Declarations(GeneratorCore))) {
  /**
   * Generates the image.
   * @returns {{image: object}|{unsupported: {construct: string, syntax: object|null, uri: string|null}}}
   */
  generate() {
    try {
      this.declareTypes();
      this.declareInitializers();
      const entry = this.entryPoint();
      this.translateMembers();
      const startup = this.startup(entry);
      for (const { method, body } of [...this.iterators.finish(), ...this.delegates.finish()]) this.bodies.push({ method, body });
      for (const { method, body } of this.bodies) new JumpIrEmitter(this.program, method).build(body);
      return { image: this.program.toImage(this.files, startup.id) };
    } catch (error) {
      if (!(error instanceof UnsupportedConstruct)) throw error;
      return { unsupported: { construct: error.construct, syntax: error.syntax, uri: error.uri } };
    }
  }
}

/** True for a method with the shape of an entry point: static `Main`, no parameters or `string[]`, returning void, int or a task. */
export function isEntryPointCandidate(method) {
  if (!method.isStatic || method.methodKind !== MethodKind.Ordinary || method.typeParameters?.length) return false;
  const parameters = method.parameters,
    result = method.returnType;
  const argsOnly = parameters.length === 1 && parameters[0].type?.elementType?.specialType === 'System_String' && parameters[0].type.rank === 1;
  if (parameters.length && !argsOnly) return false;
  return ['System_Void', 'System_Int32'].includes(result?.specialType) || result?.name === 'Task';
}

/** Generates a bytecode image from an analysed program; see `SemanticGenerator.generate`. */
export function generateFromSemanticAnalysis(analysis, files, options = {}) {
  return new SemanticGenerator(analysis, files, options).generate();
}
