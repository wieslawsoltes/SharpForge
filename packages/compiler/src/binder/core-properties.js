import {BuiltinMap} from '@sharpforge/bytecode';
import {BoundPropertyAccess} from '../bound/nodes.js';
import {pathOf} from '../type-utils.js';

/** Legacy intrinsic accessors still bind as properties; the getter stays attached to its canonical property symbol. */
export function bindCoreProperty(context, node, receiverType) {
  let name;
  let result = 'string';
  let instance = true;
  if (receiverType === 'System.Type' && ['Name', 'FullName'].includes(node.name)) name = 'Type.' + node.name;
  else if (['Exception', 'System.Exception'].includes(receiverType) && node.name === 'Message') name = 'Exception.Message';
  else if (['Environment.TickCount', 'System.Environment.TickCount'].includes(pathOf(node))) {
    name = 'Environment.TickCount';
    instance = false;
    result = 'int';
  } else return null;
  const getter = context.sym.builtin(BuiltinMap.get(name));
  const property = getter?.associatedSymbol;
  if (property?.kind !== 'Property') throw new Error('Core intrinsic getter has no property symbol: ' + name);
  return context.node(BoundPropertyAccess, node, {
    receiver: instance ? context.bindExpression(node.target) : null,
    property
  }, result);
}
