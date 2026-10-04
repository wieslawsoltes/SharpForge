/** Runtime-provided storage and synchronization identities allocate no framework member IDs. */
export function registerRuntimeControlTypes({define, types}) {
  for (const name of ['System.ArgIterator', 'System.RuntimeArgumentHandle', 'System.TypedReference', 'System.RuntimeTypeHandle']) {
    if (!types.has(name)) define(name, {kind: 'value'});
  }
  for (const name of ['System.Threading.Monitor', 'System.Threading.Interlocked', 'System.Threading.Volatile']) {
    if (!types.has(name)) define(name, {kind: 'synchronization', isStatic: true});
  }
}
