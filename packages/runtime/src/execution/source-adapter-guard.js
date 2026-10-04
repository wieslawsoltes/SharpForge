const adapters = new WeakMap();

/** Canonical function identities are captured once by the VM module, before host extensions can replace them. */
export function registerSourceAdapters(vm, canonical) {
  adapters.set(vm, canonical);
}

/** Prepared dispatch must retain own, inherited and prototype-level host adapters. */
export function hasCanonicalSourceAdapters(vm) {
  const canonical = adapters.get(vm);
  return canonical !== undefined && vm.call === canonical.call && vm.binary === canonical.binary &&
    vm.transfer === canonical.transfer && vm.constant === canonical.constant && vm.notifyWrite === canonical.notifyWrite;
}
