/** Preserve function-pointer calling convention/instance information in CLI display types. */
export function functionPointerType(signature) {
  const convention = signature.callingConvention ? `unmanaged[${signature.callingConvention}] ` : '';
  const instance = signature.isStatic ? '' : 'instance ';
  return 'method ' + convention + instance + signature.returnType + ' *(' + signature.parameters.join(', ') + ')';
}

function splitTypes(text) {
  if (!text.trim()) return [];
  const result = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if ('<(['.includes(text[index])) depth++;
    if ('>)]'.includes(text[index])) depth--;
    if (text[index] === ',' && depth === 0) { result.push(text.slice(start, index).trim()); start = index + 1; }
  }
  result.push(text.slice(start).trim());
  return result;
}

export function parseFunctionPointerType(type) {
  if (!type.startsWith('method ')) return null;
  let text = type.slice(7);
  const convention = /^unmanaged\[(\d+)\] /.exec(text);
  if (convention) text = text.slice(convention[0].length);
  const instance = text.startsWith('instance ');
  if (instance) text = text.slice(9);
  // The result or parameters may themselves be function pointers. The outer parameter list
  // is the last separator outside balanced type arguments and nested parameter lists.
  let separator = -1, depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (depth === 0 && text.startsWith(' *(', index)) separator = index;
    if ('<(['.includes(text[index])) depth++;
    else if ('>)]'.includes(text[index])) depth--;
  }
  if (depth !== 0) return null;
  if (separator < 0 || !text.endsWith(')')) return null;
  return {kind: 'method', isStatic: !instance, callingConvention: convention ? Number(convention[1]) : 0,
    returnType: text.slice(0, separator), parameters: splitTypes(text.slice(separator + 3, -1))};
}
