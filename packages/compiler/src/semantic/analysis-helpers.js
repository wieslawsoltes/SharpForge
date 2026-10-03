/**
 * Small predicates and tables shared by the phases of the semantic analysis (semantic/*.js).
 */
import { Accessibility, TypeKind } from '../symbols/types.js';

/** The span of a syntax node or token (`.span`) or of a plain `{ start, end }` location. */
export const spanOf = node => node.span ?? node;

/** Namespaces of the BCL and platform that the closed framework registry models only in part. */
export const knownNamespaces = /^(System|Microsoft|Windows)(\.|$)/;

const frameworkTypeNames = `
  DateTime DateTimeOffset TimeSpan Guid Random Tuple ValueTuple Lazy Nullable Func Action Predicate Comparison Converter
  EventHandler EventArgs Delegate Attribute Type Uri Version Array Buffer BitConverter Convert Environment GC Math MathF
  Console String Char Int32 Int64 Double Decimal Boolean Byte Object Enum Exception ArgumentException ArgumentNullException
  ArgumentOutOfRangeException InvalidOperationException NotSupportedException NotImplementedException FormatException
  OverflowException DivideByZeroException NullReferenceException IndexOutOfRangeException InvalidCastException
  KeyNotFoundException ArithmeticException ApplicationException SystemException AggregateException
  OperationCanceledException TimeoutException ObjectDisposedException StackOverflowException OutOfMemoryException
  IOException FileNotFoundException UnauthorizedAccessException IDisposable IAsyncDisposable IComparable IEquatable
  IFormattable ICloneable IEnumerable IEnumerator ICollection IList IDictionary IReadOnlyList IReadOnlyCollection
  IReadOnlyDictionary ISet IComparer IEqualityComparer IAsyncEnumerable IAsyncEnumerator IGrouping IOrderedEnumerable
  IQueryable ILookup IObserver IObservable IProgress List Dictionary HashSet SortedSet SortedDictionary SortedList Queue
  Stack LinkedList KeyValuePair Comparer EqualityComparer Enumerable Queryable StringBuilder Encoding Regex Match Task
  ValueTask CancellationToken CancellationTokenSource Thread Interlocked Monitor Volatile Timer Stopwatch Debug Trace File
  Directory Path Stream StreamReader StreamWriter TextReader TextWriter StringReader StringWriter MemoryStream FileStream
  BinaryReader BinaryWriter Span ReadOnlySpan Memory ReadOnlyMemory Index Range Activator Expression CultureInfo
  NumberStyles StringComparison StringComparer StringSplitOptions DayOfWeek MidpointRounding FlagsAttribute
  ObsoleteAttribute SerializableAttribute Flags Obsolete Serializable Conditional CallerMemberName NotNull MaybeNull
  NotNullWhen MaybeNullWhen AllowNull DisallowNull DoesNotReturn MemberNotNull HashCode WeakReference IntPtr UIntPtr
  BigInteger Complex Vector2 Vector3 Half Int128 UInt128 Rune JsonSerializer HttpClient ImmutableArray ImmutableList
  ConcurrentDictionary ConcurrentQueue ConcurrentBag BlockingCollection ObservableCollection ReadOnlyCollection
  Collection ArrayList Hashtable BitArray PriorityQueue TaskCompletionSource Parallel SemaphoreSlim Mutex Lock
  ThreadLocal AsyncLocal Unsafe MemoryMarshal CollectionsMarshal`;

/**
 * Simple names of common BCL types. The registry does not model most of them; using one is not an error, it only
 * makes the analysis incomplete (no missing-type diagnostic is produced for it).
 */
export const frameworkNames = new Set(frameworkTypeNames.split(/\s+/).filter(Boolean));

const accessibilityOrder = [
  Accessibility.Private,
  Accessibility.ProtectedAndInternal,
  Accessibility.Protected,
  Accessibility.Internal,
  Accessibility.ProtectedOrInternal,
  Accessibility.Public,
];

/** Position of an accessibility in the order private < private protected < protected < internal < protected internal < public. */
export const accessRank = accessibility => accessibilityOrder.indexOf(accessibility);

/** True when `listed` is an interface that has `iface` among its base interfaces. */
export const baseOrSelf = (listed, iface) => listed.allInterfaces?.some(candidate => candidate.equals(iface));

/** True for symbols declared in source (the symbol or one of its containers is a source type). */
export function isSourceSymbol(symbol) {
  for (let current = symbol?.originalDefinition ?? symbol; current; current = current.containingSymbol) {
    if (current.isSource) return true;
  }
  return false;
}

/** True for types whose definition the analysis knows completely: source types and the special types. */
export const isClosedType = type => isSourceSymbol(type) || !!type.specialType;

/** The default value Roslyn prints in CS0649 ("will always have its default value ..."). */
export function defaultText(type) {
  if (!type || type.isReferenceType === true || type.isNullableValueType) return 'null';
  if (type.specialType === 'System_Boolean') return 'false';
  if (type.typeKind === TypeKind.Struct && !type.specialType) return '';
  return '0';
}

const nestedFunctionKinds = new Set([
  'LocalFunctionStatement',
  'AnonymousMethodExpression',
  'SimpleLambdaExpression',
  'ParenthesizedLambdaExpression',
]);
const awaitableStatementKinds = new Set(['LocalDeclarationStatement', 'UsingStatement', 'ForEachStatement']);

/** True when a statement awaits outside of nested functions (top-level statements then form an async Main). */
export function containsAwait(node) {
  if (node.kind === 'AwaitExpression') return true;
  if (nestedFunctionKinds.has(node.kind)) return false;
  if (awaitableStatementKinds.has(node.kind) && node.awaitKeyword) return true;
  return node.childNodes().some(containsAwait);
}
