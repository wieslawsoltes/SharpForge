/** Copy occupied numeric slots of a trusted builtin array without visiting its reserved address space. */
export function copyBuiltinArraySlots(source) {
  const entries = [];
  const slot = {value: undefined, writable: true, enumerable: true, configurable: true};
  for (const key of Object.getOwnPropertyNames(source)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= 0xffffffff || String(index) !== key) continue;
    slot.value = source[key];
    // Native slice creates own data properties, even when an array prototype has numeric setters.
    Object.defineProperty(entries, key, slot);
  }
  entries.length = source.length;
  return entries;
}
