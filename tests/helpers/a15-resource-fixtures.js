import {DependencyPropertyRegistry, PropertyStore, ResourceScope} from '@sharpforge/winui-properties';

export function propertyFixture() {
  const baseType = type => type === 'Button' || type === 'Text' ? 'Element' : null;
  const registry = new DependencyPropertyRegistry({baseType});
  const width = registry.register({ownerType: 'Element', name: 'Width', propertyType: 'double', metadata: {defaultValue: 0}});
  const text = registry.register({ownerType: 'Element', name: 'Text', propertyType: 'string', metadata: {defaultValue: ''}});
  const stores = new Map();
  const create = (type = 'Button', name = '') => {
    const target = {type, name, children: [], disposed: false};
    stores.set(target, new PropertyStore({registry, ownerType: type, owner: target}));
    return target;
  };
  const storeFor = target => stores.get(target);
  const adapter = {
    children: target => target.children,
    typeOf: target => target.type,
    name: target => target.name,
    storeFor,
    setTemplatedParent: (target, owner) => { target.templatedParent = owner; },
    attachRoot: (owner, root) => { owner.templateRoot = root; },
    detach: target => { target.detached = true; },
    dispose: target => { target.disposed = true; },
    setDataContext: (target, data) => { target.data = data; }
  };
  return {registry, width, text, stores, storeFor, create, adapter, resources: new ResourceScope()};
}

