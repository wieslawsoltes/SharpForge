/** The first TypeDef is the CLI global module type (ECMA-335 II.10). */
const MODULE_TYPE_TOKEN = 0x02000001;

/** Schedule verified module startup before the selected entry's type-initialization gate. */
export function startCilEntry(vm, entry, args) {
  vm.call(entry.token, args);
  if (vm.typeSystem.initializers.has(MODULE_TYPE_TOKEN)) {
    // Keep the entry frame parked with needsInitialization set. The existing controller supplies
    // reentrancy, once-only completion, cached failure, scheduler waiting and snapshot roots.
    vm.ensureInitialized(MODULE_TYPE_TOKEN, 'field');
  } else {
    vm.ensureInitialized(entry.ownerToken, 'static-method');
  }
}
