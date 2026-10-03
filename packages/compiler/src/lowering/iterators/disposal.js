/**
 * `IDisposable.Dispose` of an iterator object (SF-A02-T09.1).
 *
 * A machine suspended inside a try region still owes its finally blocks. Dispose resumes it with the dispose-mode
 * flag set: the resume point returns immediately from inside the protected regions, so the finally blocks run
 * innermost first, exactly once, and an exception one of them throws leaves through the enclosing ones.
 * Whatever the state was, the machine is finished afterwards: MoveNext returns false and Current keeps its value,
 * which is what a .NET iterator does (Roslyn 5.3).
 */
import { n } from '../../codegen/semantic/node-factory.js';

const anyOf = tests => tests.reduce((left, right) => n.logicalOr(left, right));

/**
 * The body of the shared class's `static void Dispose(iterator)`.
 * @param info the iterator class (`{methodField, stateField, disposingField, machines}`)  @param self reads the argument
 */
export function disposeBody(info, self) {
  const state = () => n.field(self(), info.stateField),
    statements = [];
  for (const machine of info.machines) {
    if (!machine.protectedStates.length) continue;
    const isMachine = n.equals(n.field(self(), info.methodField), n.literal(machine.id, 'int')),
      isProtected = anyOf(machine.protectedStates.map(value => n.equals(state(), n.literal(value, 'int'))));
    statements.push(
      n.ifStatement(
        n.logicalAnd(isMachine, isProtected),
        n.block([
          n.expressionStatement(n.assign(n.field(self(), info.disposingField), n.literal(true, 'bool'))),
          n.expressionStatement(n.call(machine.moveNext, null, [self()])),
        ]),
      ),
    );
  }
  statements.push(n.expressionStatement(n.assign(state(), n.literal(-1, 'int'))));
  return n.block(statements);
}
