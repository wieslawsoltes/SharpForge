// CLR exception inheritance, pinned to the .NET 10 System.Private.CoreLib contracts.
// Runtime faults use short names; user-defined qualified names must retain identity.
const bases = new Map([
  ['System.Exception', 'System.Object'],
  ['System.SystemException', 'System.Exception'],
  ['System.ArithmeticException', 'System.SystemException'],
  ['System.DivideByZeroException', 'System.ArithmeticException'],
  ['System.OverflowException', 'System.ArithmeticException'],
  ['System.ArgumentException', 'System.SystemException'],
  ['System.ArgumentNullException', 'System.ArgumentException'],
  ['System.ArgumentOutOfRangeException', 'System.ArgumentException'],
  ['System.InvalidOperationException', 'System.SystemException'],
  ['System.ObjectDisposedException', 'System.InvalidOperationException'],
  ['System.OperationCanceledException', 'System.SystemException'],
  ['System.Threading.Tasks.TaskCanceledException', 'System.OperationCanceledException'],
  ['System.Threading.ThreadStateException', 'System.SystemException'],
  ['System.Threading.SynchronizationLockException', 'System.SystemException'],
  ['System.MemberAccessException', 'System.SystemException'],
  ['System.MissingMemberException', 'System.MemberAccessException'],
  ['System.MissingMethodException', 'System.MissingMemberException'],
  ...['NullReferenceException', 'IndexOutOfRangeException', 'InvalidCastException',
    'FormatException', 'NotSupportedException', 'OutOfMemoryException',
    'StackOverflowException', 'TypeLoadException', 'TypeInitializationException',
    'InvalidProgramException', 'ArrayTypeMismatchException']
    .map(name => [`System.${name}`, 'System.SystemException'])
]);
const aliases = new Map([...bases.keys()].map(name => [name.slice(name.lastIndexOf('.') + 1), name]));
const ancestors = new Map();
for (const type of bases.keys()) {
  const chain = new Set();
  for (let current = type; current; current = bases.get(current)) chain.add(current);
  ancestors.set(type, chain);
}
export function exceptionTypeName(name) { return aliases.get(name) ?? name; }
export function exceptionMatches(actual, expected) {
  actual = exceptionTypeName(actual); expected = exceptionTypeName(expected);
  // Custom runtime faults still derive from Exception, never from an unrelated
  // framework exception merely because their final name component happens to match.
  return actual === expected || expected === 'System.Exception' || expected === 'System.Object' || !!ancestors.get(actual)?.has(expected);
}
