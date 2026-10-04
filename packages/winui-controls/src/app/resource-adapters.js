import { ResourceManager, ResourceContext } from './resource-manager.js';
import { ResourceLoader } from './resources.js';
import { ControlError } from '../policy/events.js';
import { registerMethod, registerGet, registerSet, requireService } from '../policy/adapter-helpers.js';

const prefix = 'Microsoft.Windows.ApplicationModel.Resources.';

function source(context, name = '') {
  if (!name) return requireService(context, 'stringResourceLoader');
  const dictionaries = context.services.namedResourceDictionaries?.[name];
  if (!dictionaries) throw new ControlError('SFUI1694', 'Named resource data was not supplied by the host', { name });
  return new ResourceLoader({ resources: dictionaries, language: context.services.stringResourceLoader?.language ?? 'en-US' });
}

function manager(context, receiver) {
  return context.state(receiver, 'family.resourceManager', () => new ResourceManager(source(context)));
}

function modelReference(context, type, key, model) {
  const reference = context.allocate(prefix + type, {});
  context.state(reference, key, () => model);
  return reference;
}

export function registerResourceManagerAdapters(registry) {
  registerMethod(registry, prefix + 'ResourceManager', '.ctor', (context, receiver, args) => {
    const value = context.allocate(prefix + 'ResourceManager', {});
    context.state(value, 'family.resourceManager', () => new ResourceManager(source(context, String(context.native(args[0] ?? '')))));
    return value;
  }, { kind: 'constructor' });
  registerGet(registry, prefix + 'ResourceManager', 'MainResourceMap', (context, receiver) => {
    const existing = context.read(receiver, 'MainResourceMap');
    if (context.native(existing)) return existing;
    const reference = modelReference(context, 'ResourceMap', 'family.resourceMap', manager(context, receiver).mainResourceMap);
    context.write(receiver, 'MainResourceMap', reference);
    return reference;
  });
  registerMethod(registry, prefix + 'ResourceManager', 'CreateResourceContext', (context, receiver) =>
    modelReference(context, 'ResourceContext', 'family.resourceContext', manager(context, receiver).createResourceContext()));
  registerMethod(registry, prefix + 'ResourceMap', 'GetValue', (context, receiver, args) => {
    const map = context.state(receiver, 'family.resourceMap');
    const resourceContext = args[1] && context.native(args[1]) ? context.state(args[1], 'family.resourceContext') : null;
    const candidate = map.getValue(String(context.native(args[0])), resourceContext);
    return context.allocate(prefix + 'ResourceCandidate', candidate);
  });
  registerMethod(registry, prefix + 'ResourceMap', 'GetSubtree', (context, receiver, args) =>
    modelReference(context, 'ResourceMap', 'family.resourceMap', context.state(receiver, 'family.resourceMap')
      .getSubtree(String(context.native(args[0])))));
  const resourceContext = (context, receiver) => context.state(receiver, 'family.resourceContext', () =>
    new ResourceContext(context.services.stringResourceLoader?.language ?? 'en-US'));
  registerGet(registry, prefix + 'ResourceContext', 'Language', (context, receiver) => resourceContext(context, receiver).language);
  registerSet(registry, prefix + 'ResourceContext', 'Language', (context, receiver, value) => {
    const model = resourceContext(context, receiver);
    model.setLanguage(String(context.native(value)));
    context.write(receiver, 'Language', model.language);
  });
  registerMethod(registry, prefix + 'ResourceContext', 'SetQualifierValue', (context, receiver, args) =>
    resourceContext(context, receiver).setQualifier(String(context.native(args[0])), String(context.native(args[1]))));
  registerMethod(registry, prefix + 'ResourceContext', 'GetQualifierValue', (context, receiver, args) =>
    context.managed(resourceContext(context, receiver).getQualifier(String(context.native(args[0]))), 'string'));
}
