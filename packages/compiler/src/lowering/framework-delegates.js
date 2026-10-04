import {frameworkType} from '@sharpforge/framework';
import {TypeKind} from '../symbols/types.js';
import {n} from '../codegen/semantic/node-factory.js';
import {frameworkDelegateValue} from '../codegen/semantic/framework-delegates.js';
import {lowered} from './tuples/translate-tuples.js';

/** Registered callbacks and events receive owned managed delegate objects. */
export const FrameworkDelegateTranslation = Base => class extends Base {
  checkFrameworkParameters(method, syntax) {
    const parameters = method.parameters ?? [], contract = method.contract;
    if (parameters.every((parameter, index) => parameter.type?.typeKind !== TypeKind.Delegate ||
      frameworkType(contract?.parameters[index])?.kind === 'delegate')) return;
    return super.checkFrameworkParameters(method, syntax);
  }

  arguments(node, method) {
    const contract = method?.contract;
    if (!contract?.parameters.some(type => frameworkType(type)?.kind === 'delegate')) return super.arguments(node, method);
    const positions = node.mapping?.parameterOf;
    const args = (node.args ?? []).map((argument, index) => {
      const ordinal = positions ? positions[index] : index, type = contract.parameters[ordinal];
      if (frameworkType(type)?.kind !== 'delegate') return argument;
      const expression = frameworkDelegateValue(this, argument.expression, type);
      return {...argument, expression: lowered(expression, method.parameters[ordinal].type, argument.expression.syntax)};
    });
    return super.arguments({...node, args}, method);
  }

  exprEventAssignment(node) {
    const event = node.event;
    if (this.g.isSource(event)) return super.exprEventAssignment(node);
    const accessor = node.operator === '+=' ? event.addMethod : event.removeMethod, contract = accessor?.contract;
    if (!contract || frameworkType(contract.parameters[0])?.kind !== 'delegate')
      return this.unsupported('an unregistered framework event accessor', node.syntax);
    const receiver = contract.isStatic ? null : this.expression(node.receiver);
    return n.frameworkCall(accessor, receiver, [frameworkDelegateValue(this, node.handler, contract.parameters[0])], 'void');
  }
};
