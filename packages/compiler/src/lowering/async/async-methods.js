/**
 * Async methods, lambdas and local functions lowered from bound trees (SF-A02-T09.2).
 *
 * The runtime schedules managed code cooperatively: a context keeps its frames and operand stacks while it waits, so
 * an `await` does not need the method cut into a state machine. What it needs is the continuation ABI the runtime
 * already has (`SharpForge.Runtime.Async`):
 *
 *   Task<R> Start(Func<R>)   runs the delegate as an async context, eagerly up to its first pending await,
 *                            and returns the task that completes (or faults) with the context
 *   R Await(Task<R>)         returns the result, suspending the calling context while the task is pending
 *
 * An async function `Task<R> M(args)` therefore becomes two methods and one class:
 *
 *   R <M>d__N.MoveNext(args)        the body, bound and lowered like any method; `await e` is `Async.Await(e)`
 *   class <M>d__N { receiver; args; R Invoke() => receiver.MoveNext(args); }
 *   Task<R> M(args)                 the kickoff: fills a <M>d__N and returns `Async.Start(new Func<R>(it.Invoke))`
 *
 * The body keeps the signature of the function (same owner, same parameters), so everything that says how a body
 * reaches `this`, its parameters and captured variables applies unchanged; only the image method differs.
 * Evaluation order around an await is preserved by construction (the operand stack survives the suspension), as are
 * try, catch and finally blocks containing awaits; exceptions leave the body, fault the task and are rethrown by the
 * `Await` of the caller.
 */
import { findContracts, taskResult } from '@sharpforge/framework';
import { n } from '../../codegen/semantic/node-factory.js';
import { lowerAwaitable } from './awaitable-pattern.js';

const ASYNC = 'SharpForge.Runtime.Async';

/** The `Async.Start` or `Async.Await` contract whose first parameter has the given registry type, or undefined. */
function asyncContract(name, firstParameterType) {
  return findContracts(ASYNC, name, true).find(contract => contract.parameters[0] === firstParameterType);
}

/** The registry delegate type `Async.Start` takes for a body returning `result`. */
const startDelegateType = result => (result === 'void' ? 'System.Action' : 'System.Func`1<' + result + '>');

/**
 * The result type of the body of an async function whose image return type is `returnType`:
 * `void` for `async void` and `Task`, `R` for `Task<R>`; null when the type is not a task the runtime knows.
 */
export function asyncResultType(returnType) {
  return returnType === 'void' ? 'void' : taskResult(returnType);
}

/** Class mixin for the generator: the kickoff and capture class of async functions. */
export const AsyncMethods = Base =>
  class extends Base {
    /**
     * Splits an async function. The kickoff body is emitted here; the returned method is the one the function's bound
     * body must be lowered into.
     * @param kickoff the image method of the function as declared (returns the task, or void)
     * @param {{name: string, syntax: object|null, uri: string|null}} origin the Roslyn-style machine name and the
     *   declaration, for diagnostics
     */
    asyncBody(kickoff, origin) {
      const result = asyncResultType(kickoff.returnType),
        start = result === null ? null : asyncContract(kickoff.returnType === 'void' ? 'StartVoid' : 'Start', startDelegateType(result));
      if (!start) {
        const shown = kickoff.returnType.replace('System.Threading.Tasks.', '').replace('`1', '');
        return this.unsupported(`an async function returning '${shown}' (the runtime has no task of that result type)`, origin.syntax, origin.uri);
      }
      // The roles tell a debugger which image methods are one source function (the body carries its source range).
      const asyncOrigin = kickoff.qualifiedName;
      const body = this.program.addMethod(kickoff.owner, origin.name + '.MoveNext', {
        isStatic: kickoff.isStatic,
        returnType: result,
        parameters: kickoff.parameters.map(p => ({ name: p.name, type: p.type })),
        node: kickoff.node,
        hasSource: kickoff.hasSource,
        asyncRole: 'body',
        asyncOrigin,
      });
      kickoff.asyncRole = 'kickoff';
      kickoff.asyncOrigin = asyncOrigin;
      kickoff.hasSource = false;
      const capture = this.asyncCapture(kickoff, body, origin.name),
        started = n.frameworkCall({ contract: start }, null, [capture], start.result);
      // `async void`: the task is not observable; the kickoff returns once the body suspends or ends.
      const statement = kickoff.returnType === 'void' ? n.expressionStatement(started) : n.returnStatement(started);
      this.addSynthesizedBody(kickoff, n.block([statement]));
      return body;
    }
    /** The expression that captures the receiver and arguments of a kickoff call and yields the delegate to start. */
    asyncCapture(kickoff, body, name) {
      const record = this.program.addClass(name),
        receiverField = kickoff.isStatic ? null : this.program.addField(record, '<>4__this', kickoff.owner.name),
        fields = kickoff.parameters.map(p => this.program.addField(record, p.name, p.type));
      const invoke = this.program.addMethod(record, 'Invoke', {
        isStatic: false,
        returnType: body.returnType,
        parameters: [],
        asyncRole: 'capture',
        asyncOrigin: body.asyncOrigin,
      });
      const self = () => n.thisReference(record.name),
        forwarded = n.call(body, receiverField ? n.field(self(), receiverField) : null, fields.map(field => n.field(self(), field)));
      this.addSynthesizedBody(invoke, n.block([body.returnType === 'void' ? n.expressionStatement(forwarded) : n.returnStatement(forwarded)]));
      const temp = n.newLocal('$async', record.name),
        effects = [n.assign(n.local(temp), n.allocate(record))];
      if (receiverField) effects.push(n.assign(n.field(n.local(temp), receiverField), n.thisReference(kickoff.owner.name)));
      kickoff.parameters.forEach((p, i) => {
        effects.push(n.assign(n.field(n.local(temp), fields[i]), n.parameter(n.newParameter(p.name, p.type, i))));
      });
      return n.sequence([temp], effects, n.frameworkDelegate(startDelegateType(body.returnType), invoke, n.local(temp)));
    }
    /**
     * `Async.Start(new Func<R>(receiver.method))`: runs an image method as an async context and yields its task.
     * @param {string} result the image type the method returns  @param method an instance method without parameters
     */
    startTask(result, method, receiver) {
      const delegateType = startDelegateType(result),
        start = asyncContract('Start', delegateType);
      return n.frameworkCall({ contract: start }, null, [n.frameworkDelegate(delegateType, method, receiver)], start.result);
    }
    /** `await task` as a statement or value in synthesized code (the startup method awaiting an async Main). */
    awaitTask(task, syntax = null) {
      const contract = asyncContract('Await', task.legacyType);
      if (!contract) return this.unsupported(`await of '${task.legacyType}'`, syntax);
      return n.frameworkCall({ contract }, null, [task], contract.result);
    }
  };

/** Class mixin for the body translator: `await`. */
export const AwaitTranslation = Base =>
  class extends Base {
    exprAwait(node) {
      // A pattern-based awaiter runs when it is provably complete (./awaitable-pattern.js).
      if (node.getAwaiter) return lowerAwaitable(this, node);
      const operand = this.expression(node.operand),
        contract = asyncContract('Await', operand.legacyType);
      if (!contract) return this.unsupported(`await of '${node.operand.type?.toDisplayString()}'`, node.syntax);
      return n.frameworkCall({ contract }, null, [operand], this.imageType(node.type, node.syntax));
    }
  };
