/** Object's virtual builtin is separate from Convert/Console's released display profile. */
export function objectToString(host, args) {
  const value = args[0];
  if (value === null) throw host.fault('NullReferenceException', 'Null instance receiver');
  const result = host.platform?.bclHost?.invokeObjectToString?.(host.platform, value);
  if (result?.handled) return result.value;
  return host.heap.string(host.runtimeTypeText(value) ?? host.format(value));
}
