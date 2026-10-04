import {n} from './node-factory.js';

/** The UI callback profile exposes real add/remove methods while retaining existing field-like event lowering. */
export function declareUIEventAccessors(generator, owner, event, field) {
  const containingType = event.containingType ?? event.containingSymbol;
  if (!generator.ui.accepts(containingType)) return;
  const delegate = generator.delegates.classOf(event.type, event.locations?.[0]);
  for (const [adding, existing] of [[true, event.addMethod], [false, event.removeMethod]]) {
    const name = (adding ? 'add_' : 'remove_') + event.name;
    const symbol = existing ?? {name, containingSymbol: containingType, isStatic: event.isStatic,
      declaredAccessibility: event.declaredAccessibility, parameters: [{type: event.type, refKind: 'none'}]};
    const method = generator.program.addMethod(owner, name, {isStatic: event.isStatic, returnType: 'void',
      parameters: [{name: 'value', type: field.type}], access: symbol.declaredAccessibility,
      ...generator.ui.methodMetadata(symbol), virtualSlot: name + '(' + field.type + ')'});
    const slot = field.isStatic ? n.staticField(field) : n.field(n.thisReference(owner.name), field);
    const handler = n.parameter(n.newParameter('value', field.type, 0));
    const changed = adding ? generator.delegates.combine(delegate, slot, handler) : generator.delegates.remove(delegate, slot, handler);
    generator.addSynthesizedBody(method, n.block([n.expressionStatement(n.assign(slot, changed))]));
  }
}
