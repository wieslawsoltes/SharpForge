/**
 * Iterators as state machines (SF-A02-T09.1), without interface dispatch.
 *
 * The IR has no virtual call, so `IEnumerable<T>` and `IEnumerator<T>` cannot be interfaces implemented by one class
 * per iterator method. Instead every iterator over one element type shares a single image class, and the iterator
 * method an object belongs to is a number in it:
 *
 *   class Iterator<T> { int method; int state; T current; ...hoisted locals and parameters of every iterator... }
 *   static bool   MoveNext(Iterator<T> it)        dispatches on `method` to the state machine of that iterator
 *   static Iterator<T> GetEnumerator(Iterator<T> it)   a fresh machine with the parameter values of the call
 *
 * A state machine is the iterator body with its locals hoisted into fields: `yield return e` stores `current`,
 * records the resume state and returns true; MoveNext starts by jumping to the label of the recorded state.
 * States: 0 not started, -1 running or finished, k > 0 suspended after the k-th yield.
 *
 * `yield` inside `try`/`finally` (and `using`, and a `foreach` that disposes) is lowered by ./iterators/try-regions.js;
 * `Dispose` then resumes a suspended machine in dispose mode so that its pending finally blocks run.
 *
 * Not lowered (reported as not executable): conversions of arrays or framework collections to IEnumerable<T>.
 */
import { n } from '../codegen/semantic/node-factory.js';
import { resumeDispatch } from './iterators/try-regions.js';
import { disposeBody } from './iterators/disposal.js';

export class IteratorClasses {
  /** @param generator `{program}` */
  constructor(generator) {
    this.program = generator.program;
    this.byElement = new Map();
  }
  /** The shared iterator class for an element image type, declared on first use. */
  classOf(elementType) {
    let info = this.byElement.get(elementType);
    if (info) return info;
    const record = this.program.addClass(`<>Iterator(${elementType})`);
    info = { elementType, record, machines: [] };
    info.methodField = this.program.addField(record, 'method', 'int');
    info.stateField = this.program.addField(record, '<>1__state', 'int');
    info.currentField = this.program.addField(record, '<>2__current', elementType);
    info.disposingField = this.program.addField(record, '<>w__disposeMode', 'bool');
    const self = [{ name: 'iterator', type: record.name }];
    info.moveNext = this.program.addMethod(record, 'MoveNext', { isStatic: true, returnType: 'bool', parameters: self });
    info.getEnumerator = this.program.addMethod(record, 'GetEnumerator', { isStatic: true, returnType: record.name, parameters: self });
    info.dispose = this.program.addMethod(record, 'Dispose', { isStatic: true, returnType: 'void', parameters: self });
    this.byElement.set(elementType, info);
    return info;
  }
  isIteratorClass(imageType) {
    return [...this.byElement.values()].some(info => info.record.name === imageType);
  }
  infoOf(imageType) {
    return [...this.byElement.values()].find(info => info.record.name === imageType) ?? null;
  }
  /**
   * Registers the state machine of one iterator method.
   * @param {string} name the Roslyn-style machine name (`<M>d__0`)
   * @returns `{id, moveNext, proxies, protectedStates}`: `proxies` collects `{initial, live}` field pairs for
   *   parameters and `this`; `protectedStates` the resume states that lie inside a try region
   */
  addMachine(info, name) {
    const machine = { id: info.machines.length + 1, name, proxies: [], protectedStates: [] };
    machine.moveNext = this.program.addMethod(info.record, name + '.MoveNext', {
      isStatic: true,
      returnType: 'bool',
      parameters: [{ name: 'iterator', type: info.record.name }],
    });
    info.machines.push(machine);
    return machine;
  }
  /** A hoisted field of the shared class; names are prefixed with the machine so iterators do not collide. */
  addField(info, machine, name, type) {
    return this.program.addField(info.record, `${machine.name}.${name}`, type);
  }
  /** The expression that creates the iterator object of a call: parameters are stored twice, as given and live. */
  create(info, machine, values) {
    const temp = n.newLocal('$iterator', info.record.name),
      effects = [n.assign(n.local(temp), n.allocate(info.record)), n.assign(n.field(n.local(temp), info.methodField), n.literal(machine.id, 'int'))];
    machine.proxies.forEach((proxy, i) => {
      effects.push(n.assign(n.field(n.local(temp), proxy.initial), values[i]()));
      effects.push(n.assign(n.field(n.local(temp), proxy.live), values[i]()));
    });
    return n.sequence([temp], effects, n.local(temp));
  }
  /**
   * Instance methods `MoveNextAsync()` and `DisposeAsync()` of an iterator class, declared on first use: they forward
   * to the dispatchers, so that the members of `IAsyncEnumerator<T>` can be started as tasks.
   */
  asyncThunks(info) {
    if (!info.asyncThunks) {
      const declare = (name, returnType) => this.program.addMethod(info.record, name, { isStatic: false, returnType, parameters: [] });
      info.asyncThunks = { moveNext: declare('MoveNextAsync', 'bool'), dispose: declare('DisposeAsync', 'void') };
    }
    return info.asyncThunks;
  }
  /** Bodies of the dispatchers (and async thunks) of every iterator class: `[{method, body}]`. */
  finish() {
    const bodies = [];
    for (const info of this.byElement.values()) {
      const type = info.record.name,
        self = () => n.parameter(n.newParameter('iterator', type, 0)),
        isMachine = machine => n.equals(n.field(self(), info.methodField), n.literal(machine.id, 'int'));
      const dispatch = info.machines.map(machine => n.ifStatement(isMachine(machine), n.returnStatement(n.call(machine.moveNext, null, [self()]))));
      bodies.push({ method: info.moveNext, body: n.block([...dispatch, n.returnStatement(n.literal(false, 'bool'))]) });
      const copy = n.newLocal('copy', type),
        statements = [
          n.declare([[copy, n.allocate(info.record)]]),
          n.expressionStatement(n.assign(n.field(n.local(copy), info.methodField), n.field(self(), info.methodField))),
        ];
      for (const machine of info.machines) {
        const restore = machine.proxies.flatMap(proxy => [
          n.expressionStatement(n.assign(n.field(n.local(copy), proxy.initial), n.field(self(), proxy.initial))),
          n.expressionStatement(n.assign(n.field(n.local(copy), proxy.live), n.field(self(), proxy.initial))),
        ]);
        if (restore.length) statements.push(n.ifStatement(isMachine(machine), n.block(restore)));
      }
      statements.push(n.returnStatement(n.local(copy)));
      bodies.push({ method: info.getEnumerator, body: n.block(statements, [copy]) });
      bodies.push({ method: info.dispose, body: disposeBody(info, self) });
      if (info.asyncThunks) {
        const receiver = () => n.thisReference(type);
        bodies.push({ method: info.asyncThunks.moveNext, body: n.block([n.returnStatement(n.call(info.moveNext, null, [receiver()]))]) });
        bodies.push({ method: info.asyncThunks.dispose, body: n.block([n.expressionStatement(n.call(info.dispose, null, [receiver()]))]) });
      }
    }
    return bodies;
  }
}

/**
 * The MoveNext body of a state machine: resume dispatch, the lowered iterator body, and the final `return false`.
 * @param hoist the machine being built (`{info, self, dispatch}`)  @param body the lowered iterator body
 */
export function stateMachineBody(hoist, body) {
  const { info, self } = hoist,
    state = () => n.field(self(), info.stateField),
    finished = n.literal(-1, 'int');
  return n.block([
    ...resumeDispatch(state, hoist.dispatch),
    n.ifStatement(n.notEquals(state(), n.literal(0, 'int')), n.returnStatement(n.literal(false, 'bool'))),
    n.expressionStatement(n.assign(state(), finished)),
    body,
    n.expressionStatement(n.assign(state(), finished)),
    n.returnStatement(n.literal(false, 'bool')),
  ]);
}

/** The statements of `yield break`: a return, so the finally blocks of enclosing try regions run on the way out. */
export function yieldBreak(hoist, syntax) {
  return n.block([
    n.expressionStatement(n.assign(n.field(hoist.self(), hoist.info.stateField), n.literal(-1, 'int')), syntax),
    n.returnStatement(n.literal(false, 'bool')),
  ]);
}
