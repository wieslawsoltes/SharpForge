import { createAutomationMemberServices } from './member-service.js';
import { automationNamespace, peerNamespace, providerNamespace, peerMethods, peerCoreMethods,
  providerMembers, textRangeMembers, automationIdentifiers } from './member-schema.js';

function service(context) {
  const configured = context.services.automation;
  if (configured?.member) return configured;
  if (!context.host?.automation) throw new Error('SFAX016: Automation member service is not installed');
  return createAutomationMemberServices(context);
}

/** Exact UIExtensionRegistry adapters; renderer descriptors use registerAutomationAdapters separately. */
export function registerAutomationMemberAdapters(registry) {
  const peer = peerNamespace + 'AutomationPeer';
  const framework = peerNamespace + 'FrameworkElementAutomationPeer';
  const member = ({ context, receiver, args, descriptor }) => service(context).member(receiver, descriptor, args);
  for (const name of [...peerMethods, ...peerCoreMethods]) registry.register({ owner: peer, name }, member);
  for (const kind of ['get', 'set']) registry.register({ owner: peer, kind, name: kind + '_EventsSource' }, member);
  registry.register({ owner: framework, kind: 'get', name: 'get_Owner' }, member);
  registry.register({ owner: framework, kind: 'constructor', name: '.ctor' }, ({ context, descriptor, args }) =>
    service(context).constructPeer(descriptor.owner, args));
  for (const name of ['CreatePeerForElement', 'FromElement']) registry.register({ owner: framework, name, arity: 1 },
    ({ context, args }) => service(context).peerFor(args[0], name === 'FromElement'));
  registry.register({ owner: 'Microsoft.UI.Xaml.UIElement', name: 'OnCreateAutomationPeer', arity: 0 },
    ({ context, receiver }) => service(context).baseCreatePeer(receiver));
  for (const spec of [...Object.values(providerMembers), textRangeMembers]) {
    const owner = providerNamespace + spec.name;
    for (const name of spec.properties) registry.register({ owner, kind: 'get', name: 'get_' + name }, member);
    for (const name of spec.methods) registry.register({ owner, name }, member);
  }
  for (const [group, properties] of Object.entries(automationIdentifiers)) for (const property of properties) {
    registry.register({ owner: automationNamespace + group, kind: 'get', name: 'get_' + property + 'Property' },
      ({ context }) => service(context).propertyIdentity(group, property));
  }
  return registry;
}
