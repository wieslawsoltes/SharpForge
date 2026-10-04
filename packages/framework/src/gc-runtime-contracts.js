/** CLI RuntimeHelpers used by compiler-emitted primitive array initialization. */
export function registerGCRuntimeContracts({define, member, types}) {
  const owner = 'System.Runtime.CompilerServices.RuntimeHelpers';
  if (!types.has('System.RuntimeFieldHandle')) define('System.RuntimeFieldHandle', {kind: 'value', base: 'System.ValueType'});
  define(owner, {kind: 'static', runtimeHandler: 'gc', family: 'gcRuntimeHelpers'});
  member(owner, 'InitializeArray', ['System.Array', 'System.RuntimeFieldHandle'], 'void', {isStatic: true});
}
