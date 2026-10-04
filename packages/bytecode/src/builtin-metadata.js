/** Canonical declaring types for the stable core builtin table; shared by binding and metadata navigation. */
export const builtinOwners = Object.freeze({
  Console: 'System.Console', Math: 'System.Math', GC: 'System.GC', int: 'System.Int32',
  double: 'System.Double', decimal: 'System.Decimal', Convert: 'System.Convert', string: 'System.String',
  Array: 'System.Array', object: 'System.Object', Exception: 'System.Exception',
  Debug: 'System.Diagnostics.Debug', Environment: 'System.Environment',
  Enum: 'System.Enum', Type: 'System.Type', BitConverter: 'System.BitConverter',
  nint: 'System.IntPtr', nuint: 'System.UIntPtr'
});

const parameterTypes = Object.freeze({any: 'object', number: 'double', array: 'System.Array', exception: 'Exception'});
const staticStrings = new Set(['Concat', 'IsNullOrEmpty', 'Intern', 'IsInterned']);
const properties = new Set(['Exception.Message', 'Environment.TickCount', 'Type.Name', 'Type.FullName']);

/** Describe the source-visible member without changing its stable runtime ID or receiver-inclusive parameter table. */
export function builtinMemberShape(builtin) {
  const control = builtin.synchronization ?? builtin.varargs;
  if (control) {
    const property = control.name.startsWith('get_'), constructor = control.name === '.ctor';
    return {name: constructor ? 'new' : property ? control.name.slice(4) : control.name,
      instance: !constructor && !control.isStatic, property};
  }
  if (builtin.numeric) return {name: builtin.numeric.name.replace(/^get_/, ''), instance: false,
    property: builtin.numeric.name.startsWith('get_')};
  if (builtin.arrayRuntime && !builtin.arrayRuntime.internal) {
    const descriptor = builtin.arrayRuntime, property = descriptor.name.startsWith('get_');
    return {name: property ? descriptor.name.slice(4) : descriptor.name, instance: !descriptor.isStatic, property};
  }
  if (builtin.math) return {name: builtin.math.name, instance: false, property: false};
  if (builtin.decimal) return {name: builtin.decimal.name, instance: false, property: false};
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

/** Map a builtin operand category to the compiler's existing source parameter type. */
export function builtinParameterType(builtin, type) {
  if (builtin.name === 'Enum.HasFlag') return 'System.Enum';
  return parameterTypes[type] ?? type;
}
