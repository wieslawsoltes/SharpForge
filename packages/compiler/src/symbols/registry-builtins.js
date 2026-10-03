/** Declaring types and source-visible shapes for the bytecode builtin catalog. */
export const builtinOwners = Object.freeze({
  Console: 'System.Console', Math: 'System.Math', GC: 'System.GC', int: 'System.Int32',
  double: 'System.Double', Convert: 'System.Convert', string: 'System.String',
  Array: 'System.Array', object: 'System.Object', Exception: 'System.Exception',
  Debug: 'System.Diagnostics.Debug', Environment: 'System.Environment',
  Enum: 'System.Enum', Type: 'System.Type'
});

const parameterTypes = Object.freeze({any: 'object', number: 'double', array: 'System.Array', exception: 'Exception'});
const staticStrings = new Set(['Concat', 'IsNullOrEmpty', 'Intern', 'IsInterned']);
const properties = new Set(['Exception.Message', 'Environment.TickCount', 'Type.Name', 'Type.FullName']);

export function builtinMemberShape(builtin) {
  const separator = builtin.name.lastIndexOf('.');
  const name = builtin.name.slice(separator + 1);
  const prefix = builtin.name.slice(0, separator);
  const instance = !!builtin.params[0] && (
    prefix === 'string' && builtin.params[0] === 'string' && !staticStrings.has(name) ||
    prefix === 'object' && name !== 'ReferenceEquals' ||
    prefix === 'Exception' && name === 'Message' || prefix === 'Enum' || prefix === 'Type'
  );
  return {name, instance, property: properties.has(builtin.name)};
}

export function builtinParameterType(builtin, type) {
  if (builtin.name === 'Enum.HasFlag') return 'System.Enum';
  return parameterTypes[type] ?? type;
}

/** The string catalog and the legacy builtin table can describe the same CLR member. */
export function existingStringContract(members, symbol) {
  if (symbol.kind !== 'Method') return null;
  return members.find(candidate => candidate.kind === 'Method' && candidate.contract &&
    candidate.name === symbol.name && candidate.isStatic === symbol.isStatic &&
    candidate.returnType.equals(symbol.returnType) && candidate.parameters.length === symbol.parameters.length &&
    candidate.parameters.every((parameter, index) => parameter.refKind === symbol.parameters[index].refKind &&
      parameter.type.equals(symbol.parameters[index].type))) ?? null;
}
