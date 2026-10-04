/** Stable internal source ABI; public GC allocators retain their generic MethodSpec signatures. */
export function registerGCArrayContracts({define, member, types}) {
  const owner = 'SharpForge.Runtime.GCArray';
  define(owner, {kind: 'static', runtimeHandler: 'gc', family: 'gcArray', sourceReferenceCell: Object.freeze({
    fields: Object.freeze(['Value', '<ArrayOwner>', '<ArrayIndex>']), value: 0, owner: 1, index: 2
  })});
  const methods = ['AllocateArray', 'AllocateUninitializedArray'].map(name => {
    const contract = member(owner, name, ['int', 'bool', 'string'], 'object', {
      isStatic: true, internal: true, gcArrayMethod: name
    });
    return Object.freeze({name, contract});
  });
  types.get('System.GC').gcArrayMethods = Object.freeze(methods);
  member(owner, 'ValidateElementReference', ['object', 'int', 'string'], 'void', {isStatic: true, internal: true});
}
