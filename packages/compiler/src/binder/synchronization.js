import {SynchronizationQueries, synchronizationBuiltin, containsLockAwait} from '../synchronization-queries.js';
import {BoundBlock, BoundLocalDeclaration, BoundMultipleLocalDeclarations, BoundLiteral, BoundCall} from '../bound/nodes.js';

/** Bind synchronization before the general framework overload path; all addresses use the shared byref binder. */
export const SynchronizationBinder = Base => class extends SynchronizationQueries(Base) {
  bindExpression(node) {
    if (node?.kind === 'Member' && this.synchronizationOwner(node) === 'System.Threading.Monitor' && node.name === 'LockContentionCount') {
      node = {...node, kind: 'Call', target: {...node, name: 'get_LockContentionCount'}, args: []};
    }
    const binding = this.synchronizationBinding(node, true);
    if (!binding) return super.bindExpression(node);
    if (binding.error) return this.bad(node);
    const intrinsic = synchronizationBuiltin(binding.template);
    if (!intrinsic) throw new Error('Synchronization descriptor has no registered builtin');
    const args = node.args.map((argument, index) => {
      const expected = binding.parameters[index];
      if (expected.endsWith('&')) return this.bindAddressArgument(argument, expected);
      const value = this.bindTyped(argument, expected);
      this.checkAssign(expected, value.legacyType, argument);
      return value;
    });
    return this.node(BoundCall, node, {receiver: null, method: this.sym.builtin(intrinsic), args, intrinsic}, binding.result);
  }

  bindStatement(node) {
    return node?.kind === 'Lock' ? this.bindLock(node) : super.bindStatement(node);
  }

  bindLock(node) {
    if (containsLockAwait(node.body)) this.c.report(node, 'CS1996');
    const expression = this.bindExpression(node.expression), type = expression.legacyType;
    if (this.synchronizationValueType(type)) this.c.report(node.expression, 'CS0185', [type]);
    const object = this.temp(type === 'null' ? 'object' : type, 'lockObject'), taken = this.temp('bool', 'lockTaken');
    const base = {uri: node.uri, start: node.start, end: node.end, debugHidden: true};
    const gate = {...base, kind: 'BoundTemp', local: object, type: object.legacyType};
    const flag = {...base, kind: 'BoundTemp', local: taken, type: 'bool'};
    const call = (name, args) => ({...base, kind: 'ExpressionStatement', expression: {...base, kind: 'Call',
      target: {...base, kind: 'Member', boundSynchronization: true, target: {...base, kind: 'Name', name: 'System.Threading.Monitor'}, name}, args}});
    const acquire = call('Enter', [gate, {...base, kind: 'RefArgument', modifier: 'ref', expression: flag}]);
    const guarded = this.bindStatement({...base, kind: 'Try',
      body: {...base, kind: 'Block', statements: [acquire, node.body]}, catches: [],
      finallyBody: {...base, kind: 'If', condition: flag, then: call('Exit', [gate]), otherwise: null}});
    return this.statement(BoundBlock, node, {locals: [object, taken], statements: [
      this.statement(BoundMultipleLocalDeclarations, null, {declarations: [
        this.statement(BoundLocalDeclaration, null, {local: object, initializer: expression}),
        this.statement(BoundLocalDeclaration, null, {local: taken, initializer: this.node(BoundLiteral, null, {value: false}, 'bool')}),
      ]}),
      guarded,
    ]});
  }
};
