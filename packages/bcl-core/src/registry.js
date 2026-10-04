const unhandled = Object.freeze({handled: false});

/** Build an immutable family index. Duplicate names/families and async hooks fail. */
export function createBclRegistry(contributions) {
  if (!Array.isArray(contributions)) throw new TypeError('BCL modules must be an array');
  const names = new Map();
  const families = new Map();
  for (const contribution of contributions) {
    if (!contribution || typeof contribution.name !== 'string' || !contribution.name ||
        typeof contribution.contracts !== 'function' || typeof contribution.invoke !== 'function' ||
        !Array.isArray(contribution.families) || !contribution.families.length ||
        contribution.extensionContracts !== undefined && typeof contribution.extensionContracts !== 'function') {
      throw new TypeError('BCL module requires a name, families, contracts and invoke');
    }
    if (names.has(contribution.name)) throw new Error(`Duplicate BCL module: ${contribution.name}`);
    const module = Object.freeze({...contribution, families: Object.freeze([...contribution.families])});
    names.set(module.name, module);
    for (const family of module.families) {
      if (typeof family !== 'string' || !family) throw new TypeError('Invalid BCL family');
      if (families.has(family)) throw new Error(`Duplicate BCL family: ${family}`);
      families.set(family, module);
    }
  }
  const modules = Object.freeze([...names.values()]);
  return Object.freeze({
    modules,
    register(registry, {names: selectedNames, group} = {}) {
      const selected = selectedNames ? selectedNames.map(name => {
        if (!names.has(name)) throw new Error(`Unknown BCL module: ${name}`);
        return names.get(name);
      }) : modules.filter(module => group === undefined || (module.group ?? 'extensions') === group ||
        group === 'extensions' && module.extensionContracts);
      for (const module of selected) {
        const hooks = [group === 'extensions' && module.extensionContracts ? module.extensionContracts : module.contracts];
        if (group === undefined && module.extensionContracts) hooks.push(module.extensionContracts);
        for (const hook of hooks) {
          const result = hook(registry);
          if (result?.then) throw new TypeError(`BCL contracts must be synchronous: ${module.name}`);
        }
      }
    },
    invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
      const module = families.get(type?.family);
      if (!module) return unhandled;
      const result = module.invoke(platform, descriptor, args, type);
      if (!result || typeof result.handled !== 'boolean' || result.then) {
        throw new TypeError(`Invalid BCL invocation result: ${module.name}`);
      }
      return result;
    }
  });
}
