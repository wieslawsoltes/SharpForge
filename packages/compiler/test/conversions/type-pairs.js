/**
 * The type-to-type pairs of the conversion corpus, by category. Each pair is `[sourceType, targetType]` as C# type
 * text bound inside `ConversionTypes<T, TClass, TStruct, TAnimal>` (prelude.js); `fromTo('a -> b; c -> d')` keeps the
 * tables readable.
 */
const fromTo = text =>
  text
    .split(/[;\n]/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.split('->').map(side => side.trim()));

const simpleTypes = ['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'char', 'float', 'double', 'decimal'];

/** Every ordered pair of the twelve simple numeric types: identity, implicit numeric and explicit numeric. */
const numericMatrix = simpleTypes.flatMap(from => simpleTypes.map(to => [from, to]));

const boolAndNative = fromTo(`
  bool -> bool; bool -> int; int -> bool; bool -> object; bool -> string; string -> bool; char -> string; string -> char
  nint -> nint; nuint -> nuint; nint -> nuint; nuint -> nint; int -> nint; nint -> int; long -> nint; nint -> long
  uint -> nuint; nuint -> uint; ulong -> nuint; nuint -> ulong; nint -> double; double -> nint; nint -> decimal
  byte -> nint; byte -> nuint; sbyte -> nuint; char -> nint; nint -> char; nuint -> float; short -> nint; nint -> object
`);

const nullable = fromTo(`
  int -> int?; int? -> int; int? -> int?; int -> long?; int? -> long?; long? -> int?; long? -> int; int? -> long
  long -> int?; double? -> decimal?; decimal? -> double; byte? -> int?; int? -> byte?; char? -> int?; int? -> char?
  int? -> object; object -> int?; int? -> System.ValueType; System.ValueType -> int?; int? -> string; bool? -> bool
  bool -> bool?; Color -> Color?; Color? -> Color; Color? -> int?; int? -> Color?; Color? -> int; int -> Color?
  Point -> Point?; Point? -> Point; Point? -> IShape; IShape -> Point?; Point? -> object; float? -> double?
  double? -> float?; int? -> double?; uint? -> int?; int? -> Point?; Point? -> int?; TStruct -> TStruct?; TStruct? -> TStruct
`);

const enumeration = fromTo(`
  Color -> Color; Color -> int; int -> Color; Color -> long; long -> Color; Color -> byte; byte -> Color
  Color -> Wide; Wide -> Color; Wide -> long; long -> Wide; Small -> byte; byte -> Small; Small -> Color
  Color -> char; char -> Color; Color -> double; double -> Color; Color -> decimal; decimal -> Color
  Color -> System.Enum; System.Enum -> Color; Color -> object; object -> Color; Color -> System.ValueType
  System.ValueType -> Color; Color -> string; string -> Color; Color -> bool; System.Enum -> object
  System.Enum -> System.ValueType; System.ValueType -> System.Enum; System.Enum -> int; Color -> nint; nint -> Color
`);

const reference = fromTo(`
  Dog -> Dog; Dog -> Animal; Animal -> Dog; Dog -> object; object -> Dog; Dog -> IShape; IShape -> Dog
  Puppy -> Animal; Puppy -> IShape; Puppy -> ISolid; Animal -> Puppy; Cat -> Animal; Animal -> Cat; Cat -> Dog
  Dog -> Cat; Cat -> IShape; IShape -> Cat; Animal -> IShape; IShape -> Animal; ISolid -> IShape; IShape -> ISolid
  IShape -> object; object -> IShape; string -> object; object -> string; string -> Animal; Animal -> string
  string -> IShape; IShape -> string; Animal -> object; object -> object
  Dog[] -> Animal[]; Animal[] -> Dog[]; Dog[] -> object[]; object[] -> Dog[]; Dog[] -> IShape[]; IShape[] -> Dog[]
  int[] -> object[]; object[] -> int[]; int[] -> long[]; int[] -> uint[]; Color[] -> int[]; int[] -> int[]
  int[] -> System.Array; System.Array -> int[]; int[] -> object; object -> int[]; int[] -> IEnumerable
  int[] -> IEnumerable<int>; IEnumerable<int> -> int[]; int[] -> IList<int>; IList<int> -> int[]
  int[] -> IReadOnlyList<int>; int[] -> ICollection<int>; int[] -> IEnumerable<long>; int[] -> IEnumerable<object>
  Dog[] -> IEnumerable<Animal>; IEnumerable<Animal> -> Dog[]; Dog[] -> IList<Animal>; Dog[] -> IReadOnlyList<object>
  Animal[] -> IEnumerable<Dog>; int[,] -> System.Array; int[,] -> int[]; int[] -> int[,]; int[,] -> IEnumerable
  int[,] -> IEnumerable<int>; int[][] -> object[]; object[] -> int[][]; int[][] -> System.Array[]
  Dog[][] -> Animal[][]; string[] -> object[]; object[] -> string[]; string[] -> IEnumerable<object>
  System.Array -> object; System.Array -> IEnumerable; IEnumerable -> System.Array; System.Array -> string
`);

const variance = fromTo(`
  IBox<Dog> -> IBox<Animal>; IBox<Animal> -> IBox<Dog>; IBox<Dog> -> IBox<Dog>; IBox<Dog> -> IBox<object>
  IBox<int> -> IBox<object>; IBox<int> -> IBox<long>; IBox<Dog> -> IBox<IShape>; IBox<Dog> -> IBox<Cat>
  ISink<Animal> -> ISink<Dog>; ISink<Dog> -> ISink<Animal>; ISink<object> -> ISink<string>; ISink<object> -> ISink<int>
  Box<Dog> -> IBox<Dog>; Box<Dog> -> IBox<Animal>; IBox<Animal> -> Box<Dog>; Box<Dog> -> Box<Animal>
  Box<Animal> -> Box<Dog>; Box<int> -> IBox<int>; Box<int> -> IBox<object>; Box<Dog> -> object
  IEnumerable<Dog> -> IEnumerable<Animal>; IEnumerable<Animal> -> IEnumerable<Dog>; IEnumerable<Dog> -> IEnumerable
  IEnumerable<int> -> IEnumerable<object>; IEnumerable<string> -> IEnumerable<object>; IList<Dog> -> IList<Animal>
  IList<Dog> -> IEnumerable<Animal>; IReadOnlyList<Dog> -> IReadOnlyList<Animal>; IList<Dog> -> ICollection<Dog>
  Func<Dog> -> Func<Animal>; Func<Animal> -> Func<Dog>; Func<int> -> Func<object>; Func<int> -> Func<long>
  Action<Animal> -> Action<Dog>; Action<Dog> -> Action<Animal>; Action<object> -> Action<string>
  Func<Animal, Dog> -> Func<Dog, Animal>; Func<Dog, Animal> -> Func<Animal, Dog>; Func<int, int> -> Func<int, int>
`);

const delegates = fromTo(`
  Transformer -> System.Delegate; System.Delegate -> Transformer; Transformer -> System.MulticastDelegate
  System.MulticastDelegate -> Transformer; Transformer -> object; object -> Transformer; Transformer -> Func<int, int>
  Func<int, int> -> Transformer; Transformer -> Handler; Producer -> AnimalFactory; AnimalFactory -> Producer
  Func<int> -> System.Delegate; System.Delegate -> Func<int>; Action -> System.MulticastDelegate; Action -> Action
  System.MulticastDelegate -> System.Delegate; System.Delegate -> System.MulticastDelegate; System.Delegate -> object
`);

const boxing = fromTo(`
  int -> object; object -> int; int -> System.ValueType; System.ValueType -> int; long -> object; object -> long
  double -> object; object -> double; char -> object; decimal -> System.ValueType; bool -> System.ValueType
  Point -> object; object -> Point; Point -> System.ValueType; System.ValueType -> Point; Point -> IShape
  IShape -> Point; Point -> ISolid; ISolid -> Point; Point -> Animal; Point -> Point; Point -> int; int -> Point
  Meters -> object; object -> Meters; System.ValueType -> object; object -> System.ValueType; int -> System.Enum
  System.ValueType -> string; int -> IShape; IShape -> int; int -> string; string -> int
`);

const typeParameters = fromTo(`
  T -> T; T -> object; object -> T; T -> string; string -> T; T -> IShape; IShape -> T; T -> int; int -> T
  TClass -> object; object -> TClass; TClass -> TClass; TClass -> string; TClass -> IShape; IShape -> TClass
  TStruct -> object; object -> TStruct; TStruct -> System.ValueType; System.ValueType -> TStruct; TStruct -> int
  TStruct -> IShape; IShape -> TStruct; TStruct -> TStruct
  TAnimal -> Animal; Animal -> TAnimal; TAnimal -> object; object -> TAnimal; TAnimal -> Dog; Dog -> TAnimal
  TAnimal -> IShape; IShape -> TAnimal; TAnimal -> T; T -> TAnimal; TAnimal -> TClass; T[] -> object[]
  TClass[] -> object[]; TAnimal[] -> Animal[]; Animal[] -> TAnimal[]; TAnimal[] -> IEnumerable<Animal>
`);

const tuples = fromTo(`
  (int, int) -> (int, int); (int, int) -> (long, long); (long, long) -> (int, int); (int, string) -> (object, object)
  (object, object) -> (int, string); (int a, int b) -> (int x, int y); (int a, int b) -> (int, int)
  (int, int) -> System.ValueTuple<int, int>; System.ValueTuple<int, int> -> (int a, int b)
  (int, int) -> object; object -> (int, int); (int, int) -> System.ValueType; (Dog, int) -> (Animal, long)
  (Animal, long) -> (Dog, int); (int, int) -> (int, int, int); (int, int) -> (string, int); (int, int)? -> (long, long)?
  (int, int) -> (long, long)?; (int, int)? -> (int, int); (int, (int, int)) -> (long, (long, long))
  (long, (long, long)) -> (int, (int, int)); (int, int) -> (Color, Color); (Color, int) -> (int, Color)
  (Meters, int) -> (double, long); (double, long) -> (Meters, int); (int, int) -> (Meters, Meters)
`);

const userDefined = fromTo(`
  Meters -> double; double -> Meters; int -> Meters; Meters -> int; Meters -> float; float -> Meters; long -> Meters
  Meters -> long; byte -> Meters; Meters -> decimal; Meters -> Meters; Meters -> string; Meters? -> double?
  Meters? -> double; Meters -> double?; double? -> Meters?; int? -> Meters?; int -> Meters?; Meters? -> Meters
  decimal -> Money; Money -> decimal; Money -> int; int -> Money; Money -> long; string -> Money; Money -> string
  Money -> object; long -> Money; Money -> double; double -> Money; Money -> byte; Money -> int?
  Celsius -> Fahrenheit; Fahrenheit -> Celsius; Celsius -> object; Celsius -> Celsius; Fahrenheit -> Animal
  char -> Meters; Meters -> char; Color -> Meters; Meters -> Color; decimal? -> Money; Money -> Color
`);

const spans = fromTo(`
  int[] -> Span<int>; int[] -> ReadOnlySpan<int>; Span<int> -> ReadOnlySpan<int>; string -> ReadOnlySpan<char>
  Dog[] -> ReadOnlySpan<Animal>; Dog[] -> Span<Animal>; Dog[] -> Span<Dog>; string[] -> ReadOnlySpan<object>
  Span<Dog> -> ReadOnlySpan<Animal>; Span<int> -> Span<int>; ReadOnlySpan<int> -> Span<int>; Span<int> -> int[]
  int[] -> Span<long>; int[] -> ReadOnlySpan<long>; int[] -> ReadOnlySpan<object>; Span<int> -> ReadOnlySpan<long>
  Span<int> -> object; string -> Span<char>; string -> ReadOnlySpan<int>; int[,] -> Span<int>; int[][] -> Span<int[]>
  ReadOnlySpan<Dog> -> ReadOnlySpan<Animal>; ReadOnlySpan<Animal> -> ReadOnlySpan<Dog>; ReadOnlySpan<int> -> ReadOnlySpan<int>
  Span<int> -> IEnumerable<int>; Span<int> -> System.ValueType; Animal[] -> ReadOnlySpan<Dog>; object[] -> Span<string>
  Animal[] -> Span<Dog>; IShape[] -> ReadOnlySpan<Cat>; Dog[] -> ReadOnlySpan<IShape>; int[] -> ReadOnlySpan<uint>
`);

/** Categories of type pairs bound at the default (latest) language version. */
export const typePairCategories = {
  'numeric matrix (identity, implicit and explicit numeric)': numericMatrix,
  'bool and native integers': boolAndNative,
  'nullable (wrapping, lifted, unwrapping)': nullable,
  enumeration,
  'reference (classes, interfaces, arrays)': reference,
  'reference (variance)': variance,
  'reference (delegates)': delegates,
  'boxing and unboxing': boxing,
  'type parameters': typeParameters,
  tuples,
  'user-defined operators': userDefined,
  'span (C# 14 first-class spans)': spans,
};

/** Span pairs classified again at C# 13, where they go through the conversion operators of the span types. */
export const csharp13TypePairs = {
  'span (C# 13, user-defined operators)': fromTo(`
    int[] -> Span<int>; int[] -> ReadOnlySpan<int>; Span<int> -> ReadOnlySpan<int>; Dog[] -> Span<Dog>
    Span<int> -> Span<int>; ReadOnlySpan<int> -> Span<int>; Span<int> -> int[]; int[] -> Span<long>
  `),
};
