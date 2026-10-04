/** Append source delegate operations after released A05 contracts. */
export function registerRuntimeDelegates({define, types, member}) {
  if (!types.has('System.Delegate')) define('System.Delegate');
  if (!types.has('System.MulticastDelegate')) define('System.MulticastDelegate', {base: 'System.Delegate'});
  for (const name of ['Combine', 'Remove']) member('System.Delegate', name,
    ['System.Delegate', 'System.Delegate'], 'System.Delegate', {isStatic: true, kind: 'delegateOperation'});
  member('System.Delegate', 'op_Equality', ['System.Delegate', 'System.Delegate'], 'bool',
    {isStatic: true, kind: 'delegateOperation'});
}
