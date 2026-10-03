import {Builtins} from '@sharpforge/bytecode';
import {n} from './node-factory.js';

const enter = Builtins.find(entry => entry?.synchronization?.owner === 'System.Threading.Monitor' &&
  entry.synchronization.name === 'Enter' && entry.synchronization.parameters.length === 2);
const exit = Builtins.find(entry => entry?.synchronization?.owner === 'System.Threading.Monitor' &&
  entry.synchronization.name === 'Exit');

/** Semantic fallback uses the same monitor and managed-address ABI as legacy lock lowering. */
export const SynchronizationTranslation = Base => class extends Base {
  stmtLock(node) {
    const gate = this.temp('object', 'lock'), taken = this.temp('bool', 'lockTaken');
    const address = {kind: 'ManagedAddress', legacyType: 'bool&', isExpression: true,
      target: n.local(taken), readonly: false};
    const acquire = n.frameworkCall({builtin: enter}, null, [n.local(gate), address], 'void');
    const release = n.frameworkCall({builtin: exit}, null, [n.local(gate)], 'void');
    const body = n.block([n.expressionStatement(acquire), this.statement(node.body)]);
    const cleanup = n.block([n.ifStatement(n.local(taken), n.expressionStatement(release))]);
    return n.block([
      n.declare([[gate, this.expression(node.expression)], [taken, n.literal(false, 'bool')]]),
      n.tryStatement(body, [], cleanup, this.span(node.syntax))
    ], [gate, taken], this.span(node.syntax));
  }

  stmtUnsafe(node) {
    // Binding owns the unsafe-context rules; each expression still needs an executable lowering.
    return this.statement(node.block);
  }
};
