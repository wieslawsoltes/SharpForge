/** Released Uri contracts retain their order and opt in to Object's virtual string slot. */
export function registerUri({define, ctor, prop, member}) {
  const owner = 'System.Uri';
  define(owner, {kind: 'network', family: 'uri'});
  ctor(owner, ['string']);
  ctor(owner, [owner, 'string']);
  for (const [name, type] of [
    ['OriginalString', 'string'], ['AbsoluteUri', 'string'], ['AbsolutePath', 'string'],
    ['Host', 'string'], ['Scheme', 'string'], ['Port', 'int'], ['IsAbsoluteUri', 'bool']
  ]) prop(owner, name, type, null, true);
  member(owner, 'ToString', [], 'string', {objectToStringOverride: true});
  for (const name of ['EscapeDataString', 'UnescapeDataString']) member(owner, name, ['string'], 'string', {isStatic: true});
}
