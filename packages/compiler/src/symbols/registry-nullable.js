/** Resolve both registry nullable spellings to the same core-library Nullable<T> symbol. */
export function registryNullableType(bridge, name) {
  if (name.length > 1024) return null;
  const elementName = name.endsWith('?') ? name.slice(0, -1) : /^System\.Nullable(?:`1)?<([^<>]+)>$/.exec(name)?.[1];
  if (!elementName) return null;
  const element = bridge.typeFromName(elementName.trim());
  if (!element) return null;
  const type = bridge.coreType('System_Nullable_T').construct(element);
  bridge.remember(name, type);
  return type;
}
