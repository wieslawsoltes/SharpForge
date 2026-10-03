/**
 * C# programs with lambdas nested `depth` deep.
 *
 * A lambda body is bound once per delegate type it is tried against and once more to report its diagnostics. When
 * each of those bindings binds the lambdas nested in it from scratch, the work is exponential in `depth`.
 */

const repeat = (count, part) => Array.from({ length: count }, (_, index) => part(index)).join('');

const program = (members, body) => `using System; class Program { ${members} static void Main() { ${body} } }`;
const single = 'static int F(Func<int, int> f) { return f(1); }';
const generic = 'static T F<T>(Func<int, T> f) { return f(1); }';
const overloaded = `${single} static long F(Func<long, long> f) { return f(1); }`;

/** Shapes whose lambdas have one candidate delegate type per level: the work must be polynomial in depth. */
export const lambdaShapes = {
  curriedLambda: depth =>
    program('', `${'Func<int, '.repeat(depth)}int${repeat(depth, () => '> ')} f = ${repeat(depth, i => `a${i} => `)}a0;`),
  lambdaArgument: depth => program(single, `var r = ${repeat(depth, i => `F(a${i} => `)}1${')'.repeat(depth)};`),
  blockLambdaArgument: depth => program(single, `var r = ${repeat(depth, i => `F(a${i} => { return `)}1${'; })'.repeat(depth)};`),
  genericLambdaArgument: depth => program(generic, `var r = ${repeat(depth, i => `F(a${i} => `)}1${')'.repeat(depth)};`),
  actionArgument: depth =>
    program('static void F(Action f) { f(); }', `${repeat(depth, () => 'F(() => ')}F(() => { })${')'.repeat(depth)};`),
};

/**
 * Two applicable overloads with different parameter types at every level. Each level really has to be bound for both
 * (the inner lambdas see a different parameter type), so this is exponential in a C# compiler too; it is here to
 * keep the base of the exponent from growing.
 */
export const overloadedLambdaShape = depth => program(overloaded, `var r = ${repeat(depth, i => `F(a${i} => `)}1${')'.repeat(depth)};`);
