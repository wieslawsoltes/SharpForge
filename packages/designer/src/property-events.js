import {canonicalType, eventsFor, frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {authoringError, qualifiedIdentifier, resourceKey} from './property-diagnostics.js';

/** Event-handler candidates are checked against the framework's delegate signature. */
export function compatibleDesignerHandlers(type, event, handlers) {
  const delegate = frameworkType(eventsFor(canonicalType(type))[event]);
  if (!delegate || delegate.kind !== 'delegate') authoringError('SFD1842', `Unknown event ${event}.`);
  return handlers.filter(handler => {
    if (!handler || handler.accessible === false || handler.generic || !Array.isArray(handler.parameters)) return false;
    if (canonicalType(handler.returnType ?? 'void') !== delegate.result || handler.parameters.length !== delegate.parameters.length) return false;
    return handler.parameters.every((parameter, index) => {
      const typeName = canonicalType(typeof parameter === 'string' ? parameter : parameter.type);
      return !parameter?.refKind && frameworkAssignable(typeName, delegate.parameters[index]);
    });
  }).map(handler => ({...handler, name: qualifiedIdentifier(handler.name, 'Handler')}))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

export function setDesignerEventHandler(document, id, event, name, handlers) {
  const node = document.node(id);
  if (!node) authoringError('SFD1842', 'Select a control before editing its events.');
  const candidates = compatibleDesignerHandlers(node.type, event, handlers);
  if (name && !candidates.some(handler => handler.name === name)) {
    authoringError('SFD1842', 'The selected method is not a compatible accessible event handler.');
  }
  return document.change('Set ' + event + ' handler', design => {
    const target = design.nodes.find(candidate => candidate.id === id);
    if (name) target.events[event] = name;
    else delete target.events[event];
  });
}

/** Returns a source edit request; the source service owns committing it and navigation. */
export function designerEventHandlerRequest(node, event, name, {className = 'Program', existingNames = []} = {}) {
  resourceKey(name);
  qualifiedIdentifier(className, 'Handler class');
  const signature = frameworkType(eventsFor(node.type)[event]);
  if (!signature) authoringError('SFD1842', `Unknown event ${event}.`);
  const qualifiedName = className + '.' + name;
  if (existingNames.includes(qualifiedName)) authoringError('SFD1842', 'Choose a unique handler name.');
  const parameters = signature.parameters.map((type, index) => ({type, name: index === 0 ? 'sender' : index === 1 ? 'args' : 'argument' + index}));
  return {nodeId: node.id, event, name: qualifiedName, className, methodName: name, parameters, returnType: signature.result,
    source: `public static ${signature.result} ${name}(${parameters.map(parameter => parameter.type + ' ' + parameter.name).join(', ')})\n{\n}\n`};
}
