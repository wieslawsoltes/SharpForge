/**
 * The expression-to-type pairs of the conversion corpus, by category: conversions that depend on the expression and
 * not only on its type. Each pair is `[expression, targetType]`; `toEach(expression, 'a; b')` pairs one expression
 * with several targets. Expressions are bound as field initializers of `ConversionExpressions` (prelude.js).
 */
const toEach = (expression, targets) =>
  targets
    .split(/[;\n]/)
    .map(target => target.trim())
    .filter(Boolean)
    .map(target => [expression, target]);

const nullLiteral = toEach(
  'null',
  `string; object; Animal; IShape; int[]; int?; Color?; Point?; Transformer; Func<int>; IEnumerable<int>; System.Delegate
   int; Color; Point; bool; (int, int); (int, int)?; Meters; Meters?; Money; System.ValueType; System.Enum; decimal`,
);

const defaultLiteral = toEach('default', 'int; string; Point; Color; int?; Animal; (int, int); Transformer; decimal; bool');

const constants = [
  ...toEach('1', 'byte; sbyte; short; ushort; uint; ulong; long; char; float; double; decimal; int; object; int?; byte?; Color; Color?; bool'),
  ...toEach('0', 'Color; Color?; Wide; Small; byte; char; uint; Meters; Point; string; nint; nuint'),
  ...toEach('300', 'byte; sbyte; short; ushort; char; byte?; Small'),
  ...toEach('-1', 'uint; ulong; byte; sbyte; ushort; long; char; uint?; nuint; nint'),
  ...toEach('1L', 'int; ulong; uint; long; byte; double; ulong?; Color'),
  ...toEach('-1L', 'ulong; long; int'),
  ...toEach('1u', 'int; byte; long; ulong'),
  ...toEach('1UL', 'long; int'),
  ...toEach("'a'", 'int; byte; short; ushort; char; string; double; long'),
  ...toEach('1.5', 'float; double; decimal; int; Meters'),
  ...toEach('1.5f', 'double; decimal; float'),
  ...toEach('1m', 'double; decimal; int; Money'),
  ...toEach('0.0', 'Color; int; float'),
  ...toEach('0L', 'Color; Wide'),
  ...toEach('1 + 2', 'byte; sbyte; long; char'),
  ...toEach('200 + 100', 'byte; short'),
  ...toEach('2147483647', 'uint; short; long; float; ulong'),
  ...toEach('Helpers.Seven', 'byte; sbyte; ulong; Color; char; long'),
  ...toEach('Helpers.Huge', 'int; ulong; uint; long; double'),
  ...toEach('Helpers.Tiny', 'sbyte; int; char; byte; Small'),
  ...toEach('(byte)5', 'sbyte; int; byte'),
  ...toEach('true', 'bool; int; object; bool?; string'),
  ...toEach('"text"', 'string; object; char; ReadOnlySpan<char>; Money; int'),
  ...toEach('Color.Red', 'int; Color; Wide; object; Color?; long'),
];

const values = [
  ...toEach('Helpers.Number', 'long; byte; double; object; int?; Meters; Color; string; uint; nint'),
  ...toEach('Helpers.Big', 'int; ulong; float; Meters; long?'),
  ...toEach('Helpers.Text', 'object; Money; ReadOnlySpan<char>; int'),
  ...toEach('Helpers.Pet', 'Animal; IShape; Puppy; Cat; object; ISolid'),
  ...toEach('Helpers.Origin', 'IShape; object; Point?; int'),
  ...toEach('Helpers.Shade', 'int; object; Color?; Wide; System.Enum'),
  ...toEach('Helpers.Maybe', 'int; long?; object; long; string'),
  ...toEach('Helpers.Real', 'float; Meters; decimal; double?'),
  ...toEach('Helpers.Numbers', 'Span<int>; ReadOnlySpan<int>; object[]; IEnumerable<int>; long[]; System.Array'),
];

const lambdas = [
  ...toEach('x => x', 'Transformer; Func<int, int>; Func<int, long>; Func<string, string>; Handler; Func<int>; object; System.Delegate; int'),
  ...toEach('() => 1', 'Func<int>; Func<long>; Func<object>; Func<string>; Producer; Action; Transformer'),
  ...toEach('(int x) => x * 2', 'Transformer; Func<int, int>; Func<long, long>; Func<int, object>; Handler'),
  ...toEach('(string s) => { }', 'Handler; Action<string>; Action<object>; Func<string, int>; Transformer'),
  ...toEach('() => new Dog()', 'AnimalFactory; Func<Animal>; Func<Dog>; Producer; Func<Cat>'),
  ...toEach('delegate (int x) { return x; }', 'Transformer; Func<int, int>; Handler'),
  ...toEach('delegate { }', 'Handler; Action; Action<int>'),
];

const methodGroups = [
  ...toEach('Helpers.Parse', 'Func<string, int>; Func<string, long>; Func<object, int>; Transformer; Handler; Func<string, object>'),
  ...toEach('Helpers.Twice', 'Transformer; Func<int, int>; Func<int, long>; Func<long, int>; Action<int>; Func<int>'),
  ...toEach('Helpers.Log', 'Handler; Action<string>; Action<object>; Action; Func<string, int>'),
  ...toEach('Helpers.MakeDog', 'AnimalFactory; Func<Animal>; Func<Dog>; Producer; Func<Cat>; Action'),
];

const interpolatedStrings = [
  ...toEach('$"{1} and {2}"', 'string; object; FormattableString; int; Money; Animal'),
  ...toEach('$"plain"', 'string; FormattableString; object'),
  ...toEach('$"{Helpers.Number,4:x} {Helpers.Text}"', 'string; FormattableString; ReadOnlySpan<char>'),
];

const tupleLiterals = [
  ...toEach('(1, 2)', '(int, int); (long, long); (byte, byte); (int, int)?; (object, object); object; (string, int); (int, int, int)'),
  ...toEach('(1, null)', '(long, string); (int, object); (int?, Animal); (int, int); (int, int?); (long, string)?'),
  ...toEach('(null, null)', '(string, object); (int?, int?); (int, int)'),
  ...toEach('(300, 1)', '(byte, int); (short, long)'),
  ...toEach('(1, "a")', '(long, object); (int, string); (double, ReadOnlySpan<char>); System.ValueType'),
  ...toEach('(Helpers.Number, Helpers.Pet)', '(long, Animal); (int, Dog); (byte, Animal); (object, IShape)'),
  ...toEach('(x: 1, y: 2)', '(int a, int b); (long, long)'),
  ...toEach('(0, (1, null))', '(Color, (byte, string)); (int, (int, int))'),
];

const targetTyped = [
  ...toEach('new()', 'Animal; Point; int; Dog; Meters'),
  ...toEach('[1, 2]', 'int[]; long[]; List<int>; IEnumerable<int>; Span<int>; ReadOnlySpan<byte>'),
];

/** Categories of expression pairs bound at the default (latest) language version. */
export const expressionPairCategories = {
  'null literal': nullLiteral,
  'default literal': defaultLiteral,
  'constant expressions (implicit constant, 0 to enum, narrowing)': constants,
  'typed values': values,
  'anonymous functions': lambdas,
  'method groups': methodGroups,
  'interpolated strings': interpolatedStrings,
  'tuple literals': tupleLiterals,
  'target-typed new and collection expressions': targetTyped,
};
