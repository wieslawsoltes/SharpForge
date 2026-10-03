/** Runtime-provided CLI value types have ordinary framework identities, not synthetic user classes. */
export function declareVarargsTypes(bridge) {
  for (const name of ['TypedReference', 'ArgIterator', 'RuntimeArgumentHandle', 'RuntimeTypeHandle']) {
    const type = bridge.coreType('System_' + name);
    bridge.attach(type, 'System.' + name);
    if (name === 'TypedReference') bridge.byName.set('typedref', type);
  }
}
