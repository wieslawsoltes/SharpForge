// .NET 10 System.Private.CoreLib inheritance and HResults; metadata, not VM state.
const rows = [
  ['System.Exception', 'System.Object', 0x80131500],
  ['System.SystemException', 'System.Exception', 0x80131501],
  ['System.ApplicationException', 'System.Exception', 0x80131600],
  ['System.AggregateException', 'System.Exception', 0x80131500],
  ['System.Runtime.AmbiguousImplementationException', 'System.Exception', 0x8013106a],
  ['System.ArithmeticException', 'System.SystemException', 0x80070216],
  ['System.DivideByZeroException', 'System.ArithmeticException', 0x80020012],
  ['System.OverflowException', 'System.ArithmeticException', 0x80131516],
  ['System.ArgumentException', 'System.SystemException', 0x80070057],
  ['System.ArgumentNullException', 'System.ArgumentException', 0x80004003],
  ['System.ArgumentOutOfRangeException', 'System.ArgumentException', 0x80131502],
  ['System.InvalidOperationException', 'System.SystemException', 0x80131509],
  ['System.ObjectDisposedException', 'System.InvalidOperationException', 0x80131622],
  ['System.OperationCanceledException', 'System.SystemException', 0x8013153b],
  ['System.Threading.Tasks.TaskCanceledException', 'System.OperationCanceledException', 0x8013153b],
  ['System.Threading.ThreadStateException', 'System.SystemException', 0x80131520],
  ['System.Threading.SynchronizationLockException', 'System.SystemException', 0x80131518],
  ['System.MemberAccessException', 'System.SystemException', 0x8013151a],
  ['System.MissingMemberException', 'System.MemberAccessException', 0x80131512],
  ['System.MissingMethodException', 'System.MissingMemberException', 0x80131513],
  ['System.MissingFieldException', 'System.MissingMemberException', 0x80131511],
  ['System.MethodAccessException', 'System.MemberAccessException', 0x80131510],
  ['System.FieldAccessException', 'System.MemberAccessException', 0x80131507],
  ['System.TypeAccessException', 'System.TypeLoadException', 0x80131543],
  ['System.NullReferenceException', 'System.SystemException', 0x80004003],
  ['System.IndexOutOfRangeException', 'System.SystemException', 0x80131508],
  ['System.InvalidCastException', 'System.SystemException', 0x80004002],
  ['System.FormatException', 'System.SystemException', 0x80131537],
  ['System.NotSupportedException', 'System.SystemException', 0x80131515],
  ['System.PlatformNotSupportedException', 'System.NotSupportedException', 0x80131539],
  ['System.OutOfMemoryException', 'System.SystemException', 0x8007000e],
  ['System.StackOverflowException', 'System.SystemException', 0x800703e9],
  ['System.ExecutionEngineException', 'System.SystemException', 0x80131506],
  ['System.TypeLoadException', 'System.SystemException', 0x80131522],
  ['System.TypeInitializationException', 'System.SystemException', 0x80131534],
  ['System.InvalidProgramException', 'System.SystemException', 0x8013153a],
  ['System.ArrayTypeMismatchException', 'System.SystemException', 0x80131503],
  ['System.RankException', 'System.SystemException', 0x80131517]
];

/** Frozen framework exception definitions shared by verifier and both execution engines. */
export const managedExceptionTypes = Object.freeze(rows.map(([name, base, hresult]) =>
  Object.freeze({name, base, hresult: hresult | 0})));
const definitions = new Map(managedExceptionTypes.map(type => [type.name, type]));
const aliases = new Map(managedExceptionTypes.map(type => [type.name.slice(type.name.lastIndexOf('.') + 1), type.name]));
const runtimeAliases = new Map([
  ['InvalidReferenceException', 'System.InvalidProgramException'],
  ['RuntimeException', 'System.Exception'], ['AssertionException', 'System.Exception'],
  ...['InstructionLimitException', 'OutputLimitException', 'ExecutionLimitException']
    .map(name => [name, 'System.ExecutionEngineException'])
]);
const ancestors = new Map();
for (const type of managedExceptionTypes) {
  const chain = new Set();
  for (let current = type.name; current; current = definitions.get(current)?.base) chain.add(current);
  ancestors.set(type.name, chain);
}

/** Canonicalize only known short names; a user namespace is never stripped. */
export function exceptionTypeName(name) {
  return aliases.get(name) ?? runtimeAliases.get(name) ?? name;
}

export function exceptionBaseType(name) {
  return definitions.get(exceptionTypeName(name))?.base ?? null;
}

export function exceptionHResult(name) {
  return definitions.get(exceptionTypeName(name))?.hresult ?? (0x80131500 | 0);
}

/** Framework ancestry only; user-defined ancestry is resolved by the runtime type table. */
export function exceptionMatches(actual, expected) {
  actual = exceptionTypeName(actual);
  expected = exceptionTypeName(expected);
  return actual === expected || expected === 'System.Exception' || expected === 'System.Object' ||
    (ancestors.get(actual)?.has(expected) ?? false);
}
