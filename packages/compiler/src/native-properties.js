import {numericIntrinsicDefinitions} from '@sharpforge/bytecode';

const owners = Object.freeze({
  IntPtr: 'System.IntPtr', nint: 'System.IntPtr', 'System.IntPtr': 'System.IntPtr',
  UIntPtr: 'System.UIntPtr', nuint: 'System.UIntPtr', 'System.UIntPtr': 'System.UIntPtr',
});

/** Native Size is a runtime property, never a compiler-host or browser constant. */
export function nativeProperty(compiler, node) {
  if (node?.kind !== 'Member' || node.name !== 'Size') return null;
  const target = node.target;
  const path = target.kind === 'Name' ? target.name :
    target.kind === 'Member' && target.target.kind === 'Name' ? target.target.name + '.' + target.name : null;
  if (!path || compiler.lookup(path.split('.')[0]) || compiler.c.typeMap.has(path)) return null;
  const owner = owners[path];
  if (!owner) return null;
  const descriptor = numericIntrinsicDefinitions.find(candidate => candidate.owner === owner && candidate.name === 'get_Size');
  return {descriptor, result: 'int', receiver: null};
}
