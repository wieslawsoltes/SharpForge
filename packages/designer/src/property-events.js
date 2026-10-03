import {canonicalType, eventsFor, frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {authoringError, qualifiedIdentifier, resourceKey} from './property-diagnostics.js';

/** Source subscriptions expose navigation separately from the right to stage a single managed handler edit. */
export function designerEventSourceAccess(binding, {uri = ''} = {}) {
  const subscriptions = (binding?.subscriptions ?? []).map(subscription => ({...subscription,
    location: subscription.location ?? {uri, start: subscription.span?.start, end: subscription.span?.end}}));
  const editable = !binding?.dynamic && subscriptions.length <= 1 && (!binding?.capability || binding.capability === 'edit') &&
    !subscriptions.some(subscription => subscription.protected);
  const reasons = {multiple: 'Multiple subscriptions are protected. Edit their handlers in Code view.',
    lambda: 'This lambda subscription is protected. Edit it in Code view.',
    template: 'Managed event edits on template parts require Code view.'};
  return {editable, subscriptions, canNavigate: subscriptions.some(subscription => subscription.location?.uri &&
    Number.isInteger(subscription.location?.start)), reason: editable ? '' : reasons[binding?.reason] ?? 'This event is protected by source code.'};
}

function assertEventEditable(binding) {
  const access = designerEventSourceAccess(binding);
  if (!access.editable) authoringError('SFD1842', access.reason);
}

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

export function setDesignerEventHandler(document, id, event, name, handlersOrOptions) {
  const {handlers = [], sourceBinding} = Array.isArray(handlersOrOptions) ? {handlers: handlersOrOptions} : handlersOrOptions ?? {};
  assertEventEditable(sourceBinding);
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
export function designerEventHandlerRequest(node, event, name, {className = 'Program', existingNames = [], sourceBinding} = {}) {
  assertEventEditable(sourceBinding);
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
