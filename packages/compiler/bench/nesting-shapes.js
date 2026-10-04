/**
 * C# programs whose one interesting expression is nested or chained `depth` times.
 *
 * Each shape is a pattern that makes a compiler which re-derives the type of a sub-expression for every enclosing
 * node take time exponential in `depth`. The complexity tests and the compile-complexity benchmark share these.
 */

const repeat = (count, part) => Array.from({ length: count }, (_, index) => part(index)).join('');

const types = `
class Box<T> {
  public T Value;
  public Box(T value) { Value = value; }
  public Box<T> Wrap() { return this; }
  public Box<T> Next => this;
  public Box<T> Add(Box<T> other) { return this; }
  public Box<T> this[int index] => this;
}
class Plain {
  public Plain Wrap() { return this; }
  public Plain Next => this;
  public Plain Add(Plain other) { return this; }
}
`;

const main = body => `${types}class Program { static Plain F(Plain x) { return x; } static void Main() { ${body} } }`;

/** Shape name -> `depth => source`. Every shape compiles without errors at small depths. */
export const nestingShapes = {
  genericCallChain: depth => main(`var b = new Box<int>(1); var r = b${'.Wrap()'.repeat(depth)};`),
  callChain: depth => main(`var b = new Plain(); var r = b${'.Wrap()'.repeat(depth)};`),
  genericMemberChain: depth => main(`var b = new Box<int>(1); var r = b${'.Next'.repeat(depth)};`),
  memberChain: depth => main(`var b = new Plain(); var r = b${'.Next'.repeat(depth)};`),
  indexerChain: depth => main(`var b = new Box<int>(1); var r = b${'[0]'.repeat(depth)};`),
  nestedInvocation: depth => main(`var b = new Plain(); var r = ${'F('.repeat(depth)}b${')'.repeat(depth)};`),
  nestedArgument: depth => main(`var b = new Plain(); var r = ${'b.Add('.repeat(depth)}b${')'.repeat(depth)};`),
  nestedGenericType: depth => main(`${'Box<'.repeat(depth)}int${repeat(depth, () => '> ')} r = null;`),
  binaryChain: depth => main(`int a = 1; var r = a${' + a'.repeat(depth)};`),
  mixedBinaryChain: depth => main(`int a = 1; double d = 2; var r = a${repeat(depth, i => (i % 2 ? ' + d' : ' * a'))};`),
  stringConcatenation: depth => main(`string a = "x"; var r = a${' + a'.repeat(depth)};`),
  conditionalChain: depth => main(`int a = 1; var r = ${'a > 0 ? a : ('.repeat(depth)}a${')'.repeat(depth)};`),
  arrayIndexNest: depth => main(`var a = new int[1]; int i = 0; var r = ${'a['.repeat(depth)}i${']'.repeat(depth)};`),
};

/** The depths the report asks for, and that the benchmark prints. */
export const reportedDepths = [4, 8, 12, 16, 24];
