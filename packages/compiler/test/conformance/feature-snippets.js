/**
 * One minimal C# source per row of the language feature catalog (packages/syntax/src/features.js), keyed by feature
 * id (SF-A02-B01). A snippet uses the feature it is named after and nothing introduced in a later language version,
 * so compiling it one version below the feature's introduction must report exactly that feature, and compiling it at
 * the introduction version must not.
 *
 * `main` wraps statements into `Program.Main`, `type` wraps members into the `Program` class and `unit` puts
 * declarations in front of a `Program` class. The snippets are syntax-valid; many are outside the execution profile,
 * which is irrelevant here: only language-version diagnostics are inspected (tests/compiler-feature-gate-matrix.test.js).
 */
const main = body => `class Program { static void Main() { ${body} } }\n`;
const type = members => `class Program { ${members} static void Main() { } }\n`;
const unit = declarations => `${declarations}\nclass Program { static void Main() { } }\n`;

const csharp1 = {
  Classes: unit('class A { }'),
  Structs: unit('struct S { }'),
  Interfaces: unit('interface I { }'),
  Enums: unit('enum E { A, B }'),
  Delegates: unit('delegate void D();'),
  Namespaces: unit('namespace N { class A { } }'),
  UsingDirectives: 'using System;\n' + main(''),
  UsingAlias: 'using S = System.String;\n' + main(''),
  Fields: type('int count;'),
  Constants: type('const int K = 1;'),
  Methods: type('void M() { }'),
  Properties: type('int backing; int P { get { return backing; } set { backing = value; } }'),
  Indexers: type('int this[int i] { get { return i; } }'),
  Events: type('event System.EventHandler E;'),
  OperatorOverloading: unit('class A { public static A operator +(A x, A y) { return x; } }'),
  ConversionOperators: unit('class A { public static implicit operator int(A x) { return 0; } }'),
  Constructors: unit('class A { public A() { } }'),
  StaticConstructors: unit('class A { static A() { } }'),
  Destructors: unit('class A { ~A() { } }'),
  ConstructorInitializers: unit('class A { public A() : this(1) { } public A(int x) : base() { } }'),
  NestedTypes: unit('class A { class B { } }'),
  Attributes: unit('[System.Serializable] class A { }'),
  ModuleAttrLoc: '[module: System.CLSCompliant(false)]\n' + main(''),
  AttributeTargets: unit('class A { [return: System.Obsolete] int M() { return 0; } }'),
  Inheritance: unit('class A { } class B : A { }'),
  VirtualMembers: unit('abstract class A { public virtual void M() { } public abstract void N(); } class B : A { public override void N() { } }'),
  SealedMembers: unit('class A { public virtual void M() { } } class B : A { public sealed override void M() { } }'),
  NewModifier: unit('class A { public void M() { } } class B : A { public new void M() { } }'),
  ExternMembers: type('static extern void E();'),
  VolatileFields: type('volatile int count;'),
  RefOutParameters: type('static void M(ref int a, out int b) { b = a; }'),
  ParamsArrays: type('static void M(params int[] values) { }'),
  Arrays: main('int[] a = new int[2]; a[0] = 1;'),
  MultiDimensionalArrays: main('int[,] a = new int[2, 2]; a[0, 0] = 1;'),
  JaggedArrays: main('int[][] a = new int[2][]; a[0] = null;'),
  ArrayInitializers: main('int[] a = { 1, 2 }; a[0] = 1;'),
  IfStatement: main('int a = 1; if (a > 0) a = 2; else a = 3;'),
  SwitchStatement: main('int a = 1; switch (a) { case 1: a = 2; break; default: break; }'),
  WhileStatement: main('int a = 0; while (a < 2) a = a + 1;'),
  DoStatement: main('int a = 0; do { a = a + 1; } while (a < 2);'),
  ForStatement: main('for (int i = 0; i < 2; i = i + 1) { }'),
  ForEachStatement: main('int[] a = new int[1]; foreach (int x in a) { }'),
  GotoStatement: main('goto end; end: ;'),
  LabeledStatement: main('int a = 0; again: a = a + 1; if (a < 2) goto again;'),
  BreakContinue: main('for (int i = 0; i < 3; i = i + 1) { if (i == 0) continue; break; }'),
  ReturnStatement: type('static int M() { return 1; }'),
  ThrowStatement: main('throw new System.Exception();'),
  TryCatchFinally: main('try { } catch (System.Exception) { } finally { }'),
  LockStatement: main('object o = new object(); lock (o) { }'),
  UsingStatement: main('System.IDisposable d = null; using (d) { }'),
  CheckedUnchecked: main('int a = 1; a = checked(a + 1); a = unchecked(a + 1);'),
  UnsafeCode: type('static unsafe void M() { }'),
  Pointers: type('static unsafe void M(int* p) { }'),
  FixedStatement: type('static unsafe void M(int[] a) { fixed (int* p = a) { } }'),
  StackAlloc: type('static unsafe void M() { int* p = stackalloc int[2]; }'),
  SizeOf: main('int a = sizeof(int);'),
  TypeOf: main('System.Type t = typeof(int);'),
  IsAsOperators: main('object o = null; bool b = o is string; string s = o as string;'),
  CastExpressions: main('object o = 1; int a = (int)o;'),
  ConditionalOperator: main('int a = 1; int b = a > 0 ? 1 : 2;'),
  CompoundAssignment: main('int a = 1; a += 2; a *= 3;'),
  ShiftOperators: main('int a = 1; a = a << 2; a = a >> 1;'),
  VerbatimStrings: main('string s = @"a\\b";'),
  VerbatimIdentifiers: main('int @class = 1; @class = 2;'),
  UnicodeEscapes: main('string s = "\\u0041"; char c = \'\\u0042\';'),
  HexLiterals: main('int a = 0x1F;'),
  RealLiterals: main('double d = 1.5; float f = 1.5f;'),
  DecimalLiterals: main('decimal d = 1.5m;'),
  CharLiterals: main("char c = 'a';"),
  ConditionalCompilation: '#if DEBUG\n#else\n#endif\n' + main(''),
  RegionDirectives: '#region R\n#endregion\n' + main(''),
  LineDirectives: '#line 10\n' + main(''),
  DiagnosticDirectives: '#warning note\n' + main(''),
  XmlDocComments: '/// <summary>Text</summary>\n' + main(''),
  ObjectCreation: main('object o = new object();'),
  DelegateCreation: unit('delegate void D(); class A { static void M() { } static D d = new D(M); }'),
  LocalConstants: main('const int K = 1; int a = K;'),
  MultipleDeclarators: main('int a = 1, b = 2; a = b;'),
};

const csharp2 = {
  Generics: unit('class Box<T> { }'),
  AnonDelegates: unit('delegate void D(); class A { static D d = delegate { }; }'),
  GlobalNamespace: main('global::System.Console.WriteLine();'),
  FixedBuffer: unit('unsafe struct S { public fixed int Data[4]; }'),
  Pragma: '#pragma warning disable 168\n' + main(''),
  StaticClasses: unit('static class Helper { }'),
  PartialTypes: unit('partial class A { } partial class A { }'),
  Nullable: main('int? a = null; a = 1;'),
  Iterators: type('static System.Collections.IEnumerable M() { yield return 1; }'),
  Default: main('int a = default(int);'),
  PropertyAccessorMods: type('int backing; public int P { get { return backing; } private set { backing = value; } }'),
  ExternAlias: 'extern alias Lib;\n' + main(''),
  SwitchOnBool: main('bool b = true; switch (b) { case true: break; }'),
  GenericConstraints: unit('class Box<T> where T : class { }'),
  GenericMethods: type('static void M<T>(T value) { }'),
  NullCoalescing: main('string s = null; string t = s ?? "x";'),
  YieldStatement: type('static System.Collections.IEnumerable M() { yield break; }'),
  MethodGroupConversions: unit('delegate void D(); class A { static void M() { } static D d = M; }'),
  CovarianceForDelegates: unit('delegate object D(); class A { static string M() { return null; } static D d = M; }'),
  FriendAssemblies: '[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]\n' + main(''),
  PragmaWarning: '#pragma warning disable 168\n#pragma warning restore 168\n' + main(''),
  PragmaChecksum: '#pragma checksum "a.cs" "{406EA660-64CF-4C82-B6F0-42D48172A799}" "ab"\n' + main(''),
  AliasQualifiedNames: 'using S = System;\n' + main('S::Console.WriteLine();'),
};

const csharp3 = {
  ImplicitArray: main('int[] a = new[] { 1, 2 };'),
  AnonymousTypes: main('object o = new { A = 1 };'),
  ObjectInitializer: unit('class A { public int X; static A a = new A { X = 1 }; }'),
  CollectionInitializer: main(
    'System.Collections.Generic.List<int> l = new System.Collections.Generic.List<int> { 1, 2 }; l.Add(3);',
  ),
  Lambda: main('System.Func<int, int> f = x => x; f(1);'),
  QueryExpression: main('int[] a = new int[1]; object q = from x in a select x;'),
  ExtensionMethod: unit('static class E { public static int Twice(this int x) { return x * 2; } }'),
  PartialMethod: unit('partial class A { partial void M(); }'),
  ImplicitLocal: main('var a = 1; a = 2;'),
  AutoImplementedProperties: type('int P { get; set; }'),
  ExpressionTrees: main(
    'System.Linq.Expressions.Expression<System.Func<int, int>> e = delegate(int x) { return x; } as System.Linq.Expressions.Expression<System.Func<int, int>>;',
  ),
  QueryContinuation: main('int[] a = new int[1]; object q = from x in a select x into y select y;'),
  QueryJoin: main('int[] a = new int[1]; object q = from x in a join y in a on x equals y select x;'),
  QueryGroupBy: main('int[] a = new int[1]; object q = from x in a group x by x;'),
  QueryOrderBy: main('int[] a = new int[1]; object q = from x in a orderby x select x;'),
  QueryLet: main('int[] a = new int[1]; object q = from x in a let y = x select y;'),
};

const csharp4 = {
  TypeVariance: unit('interface IProducer<out T> { }'),
  NamedArgument: type('static void M(int x) { } static void N() { M(x: 1); }'),
  OptionalParameter: type('static void M(int x = 1) { }'),
  Dynamic: main('dynamic d = 1; d = 2;'),
  EmbeddedInteropTypes: unit('[System.Runtime.InteropServices.TypeIdentifier] interface I { }'),
  IndexedProperties: unit(
    '[System.Runtime.InteropServices.ComImport, System.Runtime.InteropServices.Guid("00000000-0000-0000-0000-000000000001")] interface I { }',
  ),
};

const csharp5 = {
  Async: type('static async System.Threading.Tasks.Task M() { }'),
  CallerInfoAttributes: type('static void M([System.Runtime.CompilerServices.CallerMemberName] string name = null) { }'),
  AwaitExpression: type('static async System.Threading.Tasks.Task M(System.Threading.Tasks.Task t) { await t; }'),
};

const csharp6 = {
  ExceptionFilter: main('try { } catch (System.Exception e) when (e != null) { }'),
  AutoPropertyInitializer: type('int P { get; set; } = 1;'),
  NullPropagatingOperator: main('string s = null; int? n = s?.Length;'),
  ExpressionBodiedMethod: type('static int M() => 1;'),
  ExpressionBodiedProperty: type('static int P => 1;'),
  ExpressionBodiedIndexer: type('int this[int i] => i;'),
  Nameof: main('string s = nameof(Program);'),
  DictionaryInitializer: main(
    'System.Collections.Generic.Dictionary<int, int> d = new System.Collections.Generic.Dictionary<int, int> { [1] = 2 };',
  ),
  UsingStatic: 'using static System.Math;\n' + main(''),
  InterpolatedStrings: main('int a = 1; string s = $"{a}";'),
  AwaitInCatchAndFinally: type(
    'static async System.Threading.Tasks.Task M(System.Threading.Tasks.Task t) { try { } catch { await t; } finally { await t; } }',
  ),
  ReadonlyAutoImplementedProperties: type('int P { get; }'),
  ExtensionAddMethods: unit(
    'class Bag : System.Collections.IEnumerable { public System.Collections.IEnumerator GetEnumerator() { return null; } } ' +
      'static class E { public static void Add(this Bag b, int x) { } static Bag bag = new Bag { 1 }; }',
  ),
  ParameterlessStructInitializers: unit('struct S { } class A { static S s = new S(); }'),
};

const csharp7 = {
  BinaryLiteral: main('int a = 0b101;'),
  DigitSeparator: main('int a = 1_000;'),
  LocalFunctions: main('int Local() { return 1; } Local();'),
  RefLocalsReturns: type('static int count; static ref int M() { return ref count; }'),
  PatternMatching: main('object o = 1; if (o is int i) { i = 2; }'),
  ThrowExpression: main('string s = null; string t = s ?? throw new System.Exception();'),
  Tuples: main('(int, int) t = (1, 2);'),
  OutVar: type('static void M(out int x) { x = 1; } static void N() { M(out int y); }'),
  ExpressionBodiedAccessor: type('int backing; int P { get => backing; set => backing = value; }'),
  ExpressionBodiedDeOrConstructor: unit('class A { int x; public A() => x = 1; ~A() => x = 0; }'),
  // `out var _` and `out int _` are only 'out variable declaration' to Roslyn below C# 7; `out _` is a discard.
  Discards: type('static void M(out int x) { x = 1; } static void N() { M(out _); }'),
  Deconstruction: main('int a; int b; (a, b) = (1, 2);'),
  GeneralizedAsyncReturnTypes: type('static async System.Threading.Tasks.ValueTask<int> M() { return 1; }'),
  IsPatternExpression: main('object o = 1; bool b = o is 1;'),
  CaseGuards: main('object o = 1; switch (o) { case int i when i > 0: break; }'),
};

const csharp7x = {
  AsyncMain: 'class Program { static async System.Threading.Tasks.Task Main() { await System.Threading.Tasks.Task.CompletedTask; } }\n',
  DefaultLiteral: main('int a = default;'),
  InferredTupleNames: main('int x = 1; var t = (x, 2); int y = t.x;'),
  GenericPatternMatching: type('static bool M<T>(T value) { return value is int i; }'),
  LeadingDigitSeparator: main('int a = 0x_1F;'),
  NonTrailingNamedArguments: type('static void M(int x, int y) { } static void N() { M(x: 1, 2); }'),
  PrivateProtected: unit('class A { private protected int x; }'),
  ReadOnlyReferences: type('static void M(in int x) { }'),
  RefStructs: unit('ref struct S { }'),
  ReadOnlyStructs: unit('readonly struct S { }'),
  RefExtensionMethods: unit('static class E { public static void Bump(ref this int x) { x = x + 1; } }'),
  RefConditional: main('int a = 1; int b = 2; ref int r = ref (a > 0 ? ref a : ref b);'),
  AttributesOnBackingFields: type('[field: System.NonSerialized] int P { get; set; }'),
  ImprovedOverloadCandidates: type('static void M<T>(T value) where T : class { } static void M(int value) { } static void N() { M(1); }'),
  RefReassignment: main('int a = 1; int b = 2; ref int r = ref a; r = ref b;'),
  RefFor: main('int a = 1; for (ref int r = ref a; r < 2; r = r + 1) { }'),
  RefForEach: main('System.Span<int> s = default(System.Span<int>); foreach (ref int r in s) { }'),
  EnumGenericTypeConstraint: unit('class Box<T> where T : System.Enum { }'),
  DelegateGenericTypeConstraint: unit('class Box<T> where T : System.Delegate { }'),
  UnmanagedGenericTypeConstraint: unit('class Box<T> where T : unmanaged { }'),
  StackAllocInitializer: type('static unsafe void M() { int* p = stackalloc int[] { 1, 2 }; }'),
  TupleEquality: main('bool b = (1, 2) == (1, 2);'),
  ExpressionVariablesInQueriesAndInitializers: type('static bool Try(out int x) { x = 1; return true; } static bool field = Try(out int y);'),
  ExtensibleFixedStatement: unit(
    'class Pin { public ref int GetPinnableReference() { throw null; } } class A { static unsafe void M(Pin p) { fixed (int* q = p) { } } }',
  ),
  IndexingMovableFixedBuffers: unit('unsafe struct S { public fixed int Data[4]; } class A { static S s; static unsafe int M() { return s.Data[0]; } }'),
};

const csharp8 = {
  AltInterpolatedVerbatimStrings: main('int a = 1; string s = @$"{a}";'),
  CoalesceAssignmentExpression: main('string s = null; s ??= "x";'),
  UnconstrainedTypeParameterInNullCoalescingOperator: type('static T M<T>(T a, T b) { return a ?? b; }'),
  NotNullGenericTypeConstraint: unit('class Box<T> where T : notnull { }'),
  IndexOperator: main('int[] a = new int[2]; int last = a[^1];'),
  RangeOperator: main('int[] a = new int[2]; int[] part = a[0..1];'),
  AsyncStreams: type('static async System.Threading.Tasks.Task M(System.Collections.Generic.IAsyncEnumerable<int> s) { await foreach (int x in s) { } }'),
  RecursivePatterns: main('object o = null; bool b = o is string { Length: 1 };'),
  UsingDeclarations: main('using System.IDisposable d = null;'),
  DisposalPattern: unit('ref struct R { public void Dispose() { } } class A { static void M() { using (R r = new R()) { } } }'),
  StaticLocalFunctions: main('static int Local() { return 1; } Local();'),
  NameShadowingInNestedFunctions: main('int x = 1; System.Func<int, int> f = x => x; f(x);'),
  UnmanagedConstructedTypes: unit('struct Pair<T> { public T A; } class A { static unsafe void M(Pair<int>* p) { } }'),
  ObsoleteOnPropertyAccessor: type('int P { [System.Obsolete] get { return 1; } }'),
  ReadOnlyMembers: unit('struct S { public readonly int M() { return 1; } }'),
  DefaultInterfaceImplementation: unit('interface I { void M() { } }'),
  OverrideWithConstraints: unit(
    'class A { public virtual void M<T>(T? x) where T : struct { } } ' +
      'class B : A { public override void M<T>(T? x) where T : struct { } }',
  ),
  // A conditional operator over two stackallocs initializing a local is allowed before C# 8 (pinned); parentheses are not.
  NestedStackalloc: main('System.Span<int> s = (stackalloc int[1]);'),
  NullableReferenceTypes: main('string? s = null;'),
  NullPointerConstantPattern: type('static unsafe bool M(int* p) { return p is null; }'),
  SwitchExpression: main('int a = 1; int b = a switch { 1 => 2, _ => 3 };'),
  AsyncUsing: type('static async System.Threading.Tasks.Task M(System.IAsyncDisposable d) { await using (d) { } }'),
  PropertyPatterns: main('string s = null; bool b = s is { Length: 1 };'),
  PositionalPatterns: main('(int, int) t = (1, 2); bool b = t is (1, 2);'),
  NullForgivingOperator: main('string s = null; int n = s!.Length;'),
  NullableDirective: '#nullable enable\n' + main(''),
};

const csharp9 = {
  TopLevelStatements: 'System.Console.WriteLine();\n',
  InitOnlySetters: type('int P { get; init; }'),
  Records: unit('record R(int X);'),
  ImplicitObjectCreation: main('object o = new();'),
  TargetTypedConditional: main('bool b = true; int? x = b ? 1 : null;'),
  CovariantReturnsForOverrides: unit('class A { public virtual object M() { return null; } } class B : A { public override string M() { return null; } }'),
  StaticAnonymousFunction: main('System.Func<int, int> f = static x => x; f(1);'),
  ExternLocalFunctions: main('[System.Runtime.InteropServices.DllImport("lib")] static extern void Native(); Native();'),
  ModuleInitializers: type('[System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { }'),
  FunctionPointers: type('static unsafe void M(delegate*<int, void> p) { }'),
  NativeInt: main('nint a = 1; a = 2;'),
  LocalFunctionAttributes: main('[System.Obsolete] void Local() { } Local();'),
  LambdaDiscardParameters: main('System.Func<int, int, int> f = (_, _) => 0; f(1, 2);'),
  ExtensionGetEnumerator: unit(
    'class Bag { } static class E { public static System.Collections.IEnumerator GetEnumerator(this Bag b) { return null; } ' +
      'static void M(Bag b) { foreach (object o in b) { } } }',
  ),
  ExtensionGetAsyncEnumerator: unit(
    'class Bag { } static class E { ' +
      'public static System.Collections.Generic.IAsyncEnumerator<int> GetAsyncEnumerator(this Bag b) { return null; } ' +
      'static async System.Threading.Tasks.Task M(Bag b) { await foreach (int x in b) { } } }',
  ),
  AndPattern: main('int a = 1; bool b = a is > 0 and < 2;'),
  OrPattern: main('int a = 1; bool b = a is 1 or 2;'),
  NotPattern: main('object o = null; bool b = o is not null;'),
  TypePattern: main('object o = null; bool b = o switch { int => true, _ => false };'),
  ParenthesizedPattern: main('int a = 1; bool b = a is (> 0);'),
  RelationalPattern: main('int a = 1; bool b = a is > 0;'),
  DefaultTypeParameterConstraint: unit('class A { public virtual void M<T>(T? x) { } } class B : A { public override void M<T>(T? x) where T : default { } }'),
  ExtendedPartialMethods: unit('partial class A { public partial int M(); public partial int M() { return 1; } }'),
  MemberNotNull: type('static string field; [System.Diagnostics.CodeAnalysis.MemberNotNull("field")] static void Init() { field = ""; }'),
  VarianceSafetyForStaticInterfaceMembers: unit('interface I<out T> { static void M(T value) { } }'),
  WithExpressions: unit('record R(int X); class A { static R M(R r) { return r with { X = 1 }; } }'),
  UnmanagedCallingConventions: type('static unsafe void M(delegate* unmanaged[Cdecl]<int, void> p) { }'),
};

const csharp10 = {
  MixedDeclarationsAndExpressionsInDeconstruction: main('int a; (a, int b) = (1, 2);'),
  SealedToStringInRecord: unit('record R { public sealed override string ToString() { return ""; } }'),
  RecordStructs: unit('record struct R(int X);'),
  WithOnStructs: unit('struct S { public int X; } class A { static S M(S s) { return s with { X = 1 }; } }'),
  WithOnAnonymousTypes: main('var a = new { X = 1 }; var b = a with { X = 2 };'),
  PositionalFieldsInRecords: unit('record R(int X) { public int X = X; }'),
  GlobalUsing: 'global using System;\n' + main(''),
  InferredDelegateType: main('var f = () => 1; f();'),
  LambdaAttributes: main('System.Action a = [System.Obsolete] () => { }; a();'),
  LambdaReturnType: main('System.Func<int> f = int () => 1; f();'),
  AsyncMethodBuilderOverride: type(
    '[System.Runtime.CompilerServices.AsyncMethodBuilder(typeof(System.Runtime.CompilerServices.AsyncTaskMethodBuilder))] ' +
      'static async System.Threading.Tasks.Task M() { }',
  ),
  ImplicitImplementationOfNonPublicMembers: unit('interface I { protected void M(); } class A : I { public void M() { } }'),
  LineSpanDirective: '#line (1, 1) - (1, 5) "a.cs"\n' + main(''),
  ImprovedInterpolatedStrings: type('static void M(System.Runtime.CompilerServices.DefaultInterpolatedStringHandler h) { } static void N() { M($"{1}"); }'),
  FileScopedNamespace: 'namespace N;\nclass Program { static void Main() { } }\n',
  ParameterlessStructConstructors: unit('struct S { public S() { } }'),
  StructFieldInitializers: unit('struct S { public int X = 1; public S(int y) { } }'),
  ExtendedPropertyPatterns: unit('class Node { public Node Next; public int Value; static bool M(Node n) { return n is { Next.Value: 1 }; } }'),
  ConstantInterpolatedStrings: type('const string A = "a"; const string B = $"{A}b";'),
  CallerArgumentExpression: type('static void M(bool c, [System.Runtime.CompilerServices.CallerArgumentExpression("c")] string text = null) { }'),
};

const csharp11 = {
  RawStringLiterals: main('string s = """raw""";'),
  StaticAbstractMembersInInterfaces: unit('interface I { static abstract void M(); }'),
  NewLinesInInterpolations: main('int a = 1; string s = $"{a\n}";'),
  ListPattern: main('int[] a = new int[1]; bool b = a is [1];'),
  RequiredMembers: unit('class A { public required int X { get; set; } }'),
  GenericAttributes: unit('class TagAttribute<T> : System.Attribute { } [Tag<int>] class A { }'),
  CheckedUserDefinedOperators: unit(
    'class A { public static A operator checked +(A x, A y) { return x; } public static A operator +(A x, A y) { return x; } }',
  ),
  AutoDefaultStructs: unit('struct S { public int X; public S(int y) { } }'),
  CacheStaticMethodGroupConversion: type('static void M() { } static System.Action a = M;'),
  UnsignedRightShift: main('int a = 8; a = a >>> 1;'),
  ExtendedNameofScope: type('[System.Obsolete(nameof(x))] static void M(int x) { }'),
  RelaxedShiftOperator: unit('class A { public static A operator <<(A x, A y) { return x; } }'),
  Utf8StringLiterals: main('System.ReadOnlySpan<byte> s = "text"u8;'),
  SpanCharConstantPattern: type('static bool M(System.ReadOnlySpan<char> s) { return s is "text"; }'),
  FileTypes: unit('file class A { }'),
  NumericIntPtr: main('System.IntPtr a = default(System.IntPtr); a = a + 1;'),
  RefFields: unit('ref struct S { public ref int X; }'),
  ScopedRef: type('static void M(scoped ref int x) { }'),
  SlicePattern: main('int[] a = new int[2]; bool b = a is [1, ..];'),
};

const csharp12 = {
  PrimaryConstructors: unit('class A(int x) { int X = x; }'),
  UsingTypeAlias: 'using Pair = (int, int);\n' + main(''),
  InstanceMemberInNameof: unit('class A { public string Name; static string M() { return nameof(Name.Length); } }'),
  CollectionExpressions: main('int[] a = [1, 2];'),
  RefReadonlyParameters: type('static void M(ref readonly int x) { }'),
  LambdaOptionalParameters: main('var f = (int x = 1) => x; f();'),
  LambdaParamsArray: main('var f = (params int[] values) => values.Length; f();'),
  InlineArrays: unit(
    '[System.Runtime.CompilerServices.InlineArray(4)] struct Buffer { private int element; } class A { static int M(Buffer b) { return b[0]; } }',
  ),
  ExperimentalAttribute: unit('[System.Diagnostics.CodeAnalysis.Experimental("SF0001")] class A { }'),
  SpreadElement: main('int[] a = [1]; int[] b = [..a, 2];'),
};

const csharp13 = {
  ParamsCollections: type('static void M(params System.Collections.Generic.List<int> values) { }'),
  StringEscapeCharacter: main('string s = "\\e[0m";'),
  ImplicitIndexerInitializer: unit('class Buffer { public int[] Items = new int[2]; static Buffer b = new Buffer { Items = { [^1] = 1 } }; }'),
  RefUnsafeInIteratorAsync: type('static async System.Threading.Tasks.Task M(System.Threading.Tasks.Task t) { int a = 1; ref int r = ref a; await t; }'),
  RefStructInterfaces: unit('interface I { } ref struct S : I { }'),
  AllowsRefStructConstraint: unit('class Box<T> where T : allows ref struct { }'),
  LockObject: main('System.Threading.Lock l = new System.Threading.Lock(); lock (l) { }'),
  OverloadResolutionPriority: type('[System.Runtime.CompilerServices.OverloadResolutionPriority(1)] static void M(int x) { }'),
  PartialProperties: unit('partial class A { public partial int P { get; } public partial int P { get { return 1; } } }'),
};

const csharp14 = {
  FieldKeyword: type('int P { get { return field; } set { field = value; } }'),
  FirstClassSpan: type('static void M(System.ReadOnlySpan<int> s) { } static void N(int[] a) { M(a); }'),
  UnboundGenericTypesInNameof: main('string s = nameof(System.Collections.Generic.List<>);'),
  SimpleLambdaParameterModifiers: unit('delegate void D(ref int x); class A { static D d = (ref x) => { }; }'),
  PartialEventsAndConstructors: unit('partial class A { public partial A(); public partial A() { } }'),
  Extensions: unit('static class E { extension(int x) { public int Twice() { return x * 2; } } }'),
  ExpressionOptionalAndNamedArguments: type(
    'static int M(int x = 1) { return x; } static System.Linq.Expressions.Expression<System.Func<int>> e = () => M();',
  ),
  NullConditionalAssignment: unit('class A { public int X; static void M(A a) { a?.X = 1; } }'),
  UserDefinedCompoundAssignmentOperators: unit('class A { public void operator +=(int x) { } }'),
  IgnoredDirectives: '#:package Example\n' + main(''),
};

const preview = {
  CollectionExpressionArguments: main('System.Collections.Generic.List<int> l = [with(capacity: 4), 1];'),
  LabeledBreakContinue: main('outer: for (int i = 0; i < 2; i = i + 1) { for (int j = 0; j < 2; j = j + 1) { break outer; } }'),
  ExtensionIndexers: unit('static class E { extension(int[] a) { public int this[string key] { get { return 0; } } } }'),
  Unions: unit('union Shape(int, string);'),
  ClosedClasses: unit('closed class A { }'),
  ClosedEnums: unit('closed enum E { A }'),
  SafeModifier: type('static safe void M() { }'),
  UnsafeExpressions: main('int a = unsafe(1);'),
};

/** Feature id -> source. Every catalog row has exactly one entry (asserted by the matrix test). */
export const featureSnippets = Object.freeze({
  ...csharp1,
  ...csharp2,
  ...csharp3,
  ...csharp4,
  ...csharp5,
  ...csharp6,
  ...csharp7,
  ...csharp7x,
  ...csharp8,
  ...csharp9,
  ...csharp10,
  ...csharp11,
  ...csharp12,
  ...csharp13,
  ...csharp14,
  ...preview,
});
