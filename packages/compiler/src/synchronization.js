import {Op} from '@sharpforge/bytecode';
import {SynchronizationQueries, synchronizationType, synchronizationBuiltin, containsLockAwait} from './synchronization-queries.js';

/** Explicit composition keeps the address emitter available to all registered byref profiles. */
export const SynchronizationCompiler = Base => class extends SynchronizationQueries(Base) {
  synchronizationAddress(node, {readonly = false, out = false} = {}) {
    const type = synchronizationType(this.infer(node)).replace(/&$/, ''), flag = readonly ? 4 : 0;
    if (node?.kind === 'BoundTemp') {
      this.emit(Op.ADDRESS, flag, node.slot);
      return type;
    }
    const local = node?.kind === 'Name' ? this.lookup(node.name) : null;
    if (local) {
      if (local.isConst || !readonly && (local.isUsing || local.isIteration || local.refKind === 'in')) {
        this.c.report(node, 'CS1657', [local.name, 'readonly variable']);
      }
      if (!out && !this.assigned.has(local.slot)) this.c.report(node, 'CS0165', [local.name]);
      if (local.symbol) this.c.reference(node, local.symbol);
      if (local.type.endsWith('&')) this.emit(Op.LDLOC, local.slot);
      else this.emit(Op.ADDRESS, flag, local.slot);
      return type;
    }
    if (this.property(node) || this.frameworkProperty?.(node)) {
      this.c.report(node, 'CS0206');
      this.emitConstant(null);
      return 'error';
    }
    const field = ['Name', 'Member'].includes(node?.kind) ? this.field(node) : null;
    if (field) {
      if (field.node?.modifiers?.includes('readonly') && !readonly) this.c.report(node, 'CS0192');
      if (field.symbol) this.c.reference(node, field.symbol);
      if (field.isStatic) this.emit(Op.ADDRESS, 1 | flag, field.index);
      else {
        const receiver = node.kind === 'Member' ? node.target : {...node, kind: 'Name', name: 'this'};
        if (this.synchronizationValueType(this.infer(receiver))) this.synchronizationAddress(receiver, {readonly});
        else this.expr(receiver);
        this.emit(Op.ADDRESS, 2 | flag, field.index);
      }
      return type;
    }
    if (node?.kind === 'Index' && this.infer(node.target).endsWith('[]')) {
      this.expr(node.target);
      this.arrayIndex(node.index);
      this.emit(Op.ADDRESS, 3 | flag, 0);
      return type;
    }
    this.c.report(node, 'CS1510');
    this.emitConstant(null);
    return 'error';
  }

  emitSynchronizationCall(node, binding) {
    if (binding.error) {
      this.emitConstant(null);
      return 'error';
    }
    node.args.forEach((argument, index) => {
      const expected = binding.parameters[index];
      if (expected.endsWith('&')) this.synchronizationAddress(argument.expression, {readonly: argument.modifier === 'in'});
      else this.checkAssign(expected, this.typedExpr(argument, expected), argument);
    });
    const builtin = synchronizationBuiltin(binding.template);
    if (!builtin) throw new Error('Synchronization descriptor has no registered builtin');
    this.emit(Op.BUILTIN, builtin.id, node.args.length);
    return binding.result;
  }

  synchronizationLock(node) {
    if (containsLockAwait(node.body)) this.c.report(node, 'CS1996');
    const type = synchronizationType(this.infer(node.expression));
    if (this.synchronizationValueType(type)) this.c.report(node.expression, 'CS0185', [type]);
    this.seq({...node, end: node.expression.end});
    const object = this.temp(type === 'null' ? 'object' : type), taken = this.temp('bool');
    const base = {uri: node.uri, start: node.start, end: node.end, debugHidden: true};
    this.expr(node.expression);
    this.emit(Op.STLOC, object);
    this.emit(Op.POP);
    this.emitConstant(false);
    this.emit(Op.STLOC, taken);
    this.emit(Op.POP);
    const gate = {...base, kind: 'BoundTemp', slot: object, type: this.locals[object].type};
    const flag = {...base, kind: 'BoundTemp', slot: taken, type: 'bool'};
    const call = (name, args) => ({...base, kind: 'ExpressionStatement', expression: {...base, kind: 'Call',
      target: {...base, kind: 'Member', boundSynchronization: true, target: {...base, kind: 'Name', name: 'System.Threading.Monitor'}, name}, args}});
    const acquire = call('Enter', [gate, {...base, kind: 'RefArgument', modifier: 'ref', expression: flag}]);
    this.stmt({...base, kind: 'Try', body: {...base, kind: 'Block', statements: [acquire, node.body]}, catches: [],
      finallyBody: {...base, kind: 'If', condition: flag, then: call('Exit', [gate]), otherwise: null}});
    this.clear(object);
  }

  expr(node) {
    if (node?.kind === 'Member' && this.synchronizationOwner(node) === 'System.Threading.Monitor' && node.name === 'LockContentionCount') {
      node = {...node, kind: 'Call', target: {...node, name: 'get_LockContentionCount'}, args: []};
    }
    const binding = this.synchronizationBinding(node, true);
    if (binding) return this.emitSynchronizationCall(node, binding);
    if (node?.kind === 'RefArgument') {
      this.c.report(node, 'CS1510');
      this.emitConstant(null);
      return 'error';
    }
    return super.expr(node);
  }

  stmt(node) {
    return node?.kind === 'Lock' ? this.synchronizationLock(node) : super.stmt(node);
  }
};
