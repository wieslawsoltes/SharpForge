import {Builtins} from '@sharpforge/bytecode';
import {n} from '../codegen/semantic/node-factory.js';
import {managedAddress} from '../codegen/memory-nodes.js';

const monitor = (name, parameters) => Builtins.find(builtin => {
  const profile = builtin.synchronization;
  return profile?.owner === 'System.Threading.Monitor' && profile.name === name &&
    profile.parameters.length === parameters.length && profile.parameters.every((type, index) => type === parameters[index]);
});
const enter = monitor('Enter', ['object', 'bool&']), exit = monitor('Exit', ['object']);

/** Lock evaluates its monitor once and releases only successfully acquired ownership. */
export const SynchronizationTranslation = Base => class extends Base {
  stmtLock(node) {
    if (node.expression.type?.name === 'Lock' && node.expression.type.containingSymbol?.name === 'Threading') {
      return this.unsupported('lock over System.Threading.Lock', node.syntax);
    }
    return this.scoped(() => {
      const target = this.holder('object', 'monitor'), taken = this.holder('bool', 'lockTaken');
      const source = this.expression(node.expression), span = this.span(node.syntax);
      const acquire = n.expressionStatement(n.frameworkCall({builtin: enter}, null,
        [target.read(), managedAddress(taken.read())], 'void'));
      const release = n.expressionStatement(n.frameworkCall({builtin: exit}, null, [target.read()], 'void'));
      return [target.init(this.objectArgument(source, source.legacyType), span), taken.init(n.literal(false, 'bool')),
        this.protect(node.body, () => n.block([acquire, this.embedded(node.body)]),
          () => n.block([n.ifStatement(taken.read(), release)]))];
    });
  }

  exprCall(node) {
    const method = node.method, definition = method.originalDefinition ?? method;
    const builtin = definition.builtin ?? method.builtin;
    if (!builtin?.synchronization) return super.exprCall(node);
    return n.frameworkCall({builtin}, null, this.arguments(node, method), this.imageType(node.type, node.syntax));
  }
};
