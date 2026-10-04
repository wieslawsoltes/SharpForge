const listName = /^System\.Collections\.Generic\.I(?:Enumerable|Enumerator|Collection|List|ReadOnlyCollection|ReadOnlyList)(?:`1)?<[^<>]+>$/;

/** Only the already registered closed list interfaces participate in application callback dispatch. */
export function isRegisteredListInterface(bridge, name) {
  if (!name) return false;
  const definition = bridge.types.get(name);
  if ((definition?.typeKind ?? definition?.kind) !== 'interface') return false;
  return name === 'System.Collections.IEnumerable' || name === 'System.Collections.IEnumerator' || listName.test(name);
}
