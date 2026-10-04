import {canonicalType, frameworkType} from '@sharpforge/framework';

/** The closed execution exception is exactly GC.Allocate[Uninitialized]Array<T>(int, bool): T[]. */
export function gcArrayElementType(descriptor) {
  const signature = descriptor?.signature;
  if (descriptor?.kind !== 'method' || canonicalType(descriptor.owner) !== 'System.GC' ||
      !['AllocateArray', 'AllocateUninitializedArray'].includes(descriptor.name) ||
      signature?.isStatic !== true || signature.genericArity !== 1 || signature.callingConvention ||
      signature.returnType !== '!!0[]' || signature.parameters?.length !== 2 ||
      canonicalType(signature.parameters[0]) !== 'int' || canonicalType(signature.parameters[1]) !== 'bool' ||
      !Array.isArray(descriptor.genericArguments) || descriptor.genericArguments.length !== 1) return null;
  const element = descriptor.genericArguments[0];
  if (typeof element !== 'string' || !element || element.length > 1024 ||
      /[!&*]|\b(?:void|System\.Void|pinned|modreq|modopt)\b/.test(element)) return null;
  return canonicalType(element);
}

/** Reuse an existing stable dispatch entry, specializing only the invocation's element identity. */
export function gcArrayIntrinsic(descriptor, definitions, keyOf) {
  const element = gcArrayElementType(descriptor);
  if (element === null) return null;
  const template = frameworkType('System.GC')?.gcArrayMethods?.find(method => method.name === descriptor.name)?.contract;
  if (!template) return null;
  const definition = definitions.get(keyOf({owner: template.owner, name: template.name,
    signature: {parameters: template.parameters, returnType: template.result, isStatic: true}}));
  if (!definition) return null;
  return {...definition, descriptor, contract: {...template, parameters: descriptor.signature.parameters,
    result: element + '[]', gcArrayElement: element}};
}
