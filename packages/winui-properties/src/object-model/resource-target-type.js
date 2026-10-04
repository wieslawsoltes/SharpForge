/** Typed TargetType keeps its System.Type identity; the released empty string alias means no target. */
export function resourceTargetType(context, reference, fallback = null) {
  const declared = context.read(reference, 'TargetType');
  if (declared !== null && declared !== undefined) return context.typeName(declared);
  const legacy = context.native(context.read(reference, 'TargetTypeName'));
  return legacy === null || legacy === undefined || legacy === '' ? fallback : context.typeName(legacy);
}
