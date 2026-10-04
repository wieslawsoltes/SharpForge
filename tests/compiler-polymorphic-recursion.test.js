import test from 'node:test';
import assert from 'node:assert/strict';
import { provenGrowth } from '../packages/compiler/src/lowering/generics/instantiation-growth.js';
import { NamedTypeSymbol, TypeParameterSymbol, TypeMap, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';
import { testPinnedFeature } from './support/pinned-feature.js';

// SF-A02-T02: polymorphic recursion. Cycles of constructions whose type arguments do not grow run and print what
// .NET prints (Roslyn 5.3.0, .NET 10); a cycle that provably grows is refused at once with the growth named.
testPinnedFeature('SF-A02-T02', 'polymorphic-recursion', { outputs: 3, diagnostics: 0 });

const box = 'class Box<T> { public T Value; public Box(T value) { Value = value; } }';
const program = (members, body, types = '') => `using System;\n${box}\n${types}\nclass Program { ${members} static void Main() { ${body} } }\n`;

test('A02-T02 growth proof: a substitution that nests a type parameter inside its own image grows', () => {
  const boxDefinition = new NamedTypeSymbol({ name: 'Box', arity: 1, typeKind: TypeKind.Class }),
    boxOf = type => boxDefinition.construct(type),
    a = new TypeParameterSymbol({ name: 'A' }),
    b = new TypeParameterSymbol({ name: 'B' }),
    method = { name: 'M' },
    other = { name: 'N' },
    map = (parameters, terms) => TypeMap.empty.with(parameters, terms),
    self = openMap => ({ definition: method, openMap, parent: null });
  // M<A> asks for M<Box<A>>.
  assert.equal(provenGrowth(method, [a], map([a], [boxOf(a)]), self(TypeMap.empty)).parameter, a);
  // M<A> asks for M<A>, and M<A, B> for M<B, A>: nothing grows.
  assert.equal(provenGrowth(method, [a], map([a], [a]), self(TypeMap.empty)), null);
  assert.equal(provenGrowth(method, [a, b], map([a, b], [b, a]), self(TypeMap.empty)), null);
  // M<A, B> asks for M<B, Box<A>>: A is inside its own image after two rounds.
  const twoRounds = provenGrowth(method, [a, b], map([a, b], [b, boxOf(a)]), self(TypeMap.empty));
  assert.equal(twoRounds.parameter, a);
  assert.equal(twoRounds.term.toDisplayString(), 'Box<A>');
  // M<A> asks for N<Box<A>>, which asks for M<its own parameter>: the open maps compose along the parents.
  const u = new TypeParameterSymbol({ name: 'U' }),
    viaOther = { definition: other, openMap: map([u], [boxOf(a)]), parent: self(TypeMap.empty) };
  assert.equal(provenGrowth(method, [a], map([a], [u]), viaOther).parameter, a);
  // A request whose arguments are not known as written ends the proof, here and anywhere up the chain.
  assert.equal(provenGrowth(method, [a], null, self(TypeMap.empty)), null);
  assert.equal(provenGrowth(method, [a], map([a], [u]), { definition: other, openMap: null, parent: self(TypeMap.empty) }), null);
  // A construction of another definition is not a round of the cycle.
  assert.equal(provenGrowth(method, [a], map([a], [boxOf(a)]), { definition: other, openMap: TypeMap.empty, parent: null }), null);
});

test('A02-T02 a cycle that grows is refused at its first round with the growth named', () => {
  const cases = [
    [
      program('static int D<T>(T x, int n) { return n == 0 ? 0 : 1 + D(new Box<T>(x), n - 1); }', 'Console.WriteLine(D(1, 3));'),
      /does not terminate \('Program\.D<T>\(T, int\)' instantiates itself with 'Box<T>' for 'T'; \.NET creates such constructions at run time\)/,
    ],
    [
      program(
        'static int A<T>(T x, int n) { return n == 0 ? 0 : B(x, n - 1); } static int B<U>(U y, int n) { return 1 + A(new Box<U>(y), n); }',
        'Console.WriteLine(A(1, 3));',
      ),
      /'Program\.A<T>\(T, int\)' instantiates itself with 'Box<T>' for 'T'/,
    ],
    [
      program('static int S<A, B>(A a, B b, int n) { return n == 0 ? 0 : S(b, new Box<A>(a), n - 1); }', 'Console.WriteLine(S(1, "s", 3));'),
      /'Program\.S<A, B>\(A, B, int\)' instantiates itself with 'Box<A>' for 'A'/,
    ],
    [
      program(
        '',
        'Console.WriteLine(new Tower<int>().Up(2));',
        'class Tower<T> { public int Up(int n) { return n == 0 ? 0 : 1 + new Tower<Box<T>>().Up(n - 1); } }',
      ),
      /'Tower<T>\.Up\(int\)' instantiates itself with 'Box<T>' for 'T'/,
    ],
    // A field of a larger construction: the growth is not written in a body, so the nesting limit stops it.
    [program('', 'Console.WriteLine(new Grow<int>().Next == null);', 'class Grow<T> { public Grow<Box<T>> Next; }'), /does not terminate$/],
  ];
  for (const [source, expected] of cases) assert.match(notExecutable(source).message, expected, source);
});

test('A02-T02 the refusal is located at the call that closes the cycle', () => {
  const source = program('static int D<T>(T x, int n) { return n == 0 ? 0 : 1 + D(new Box<T>(x), n - 1); }', 'Console.WriteLine(D(1, 3));');
  const reported = notExecutable(source);
  assert.equal(source.slice(reported.start, reported.start + reported.length), 'D(new Box<T>(x), n - 1)');
});

test('A02-T02 constructions deeper than the old limit of twelve levels run when nothing grows', () => {
  const ladder = Array.from({ length: 16 }, (_, i) => `static int L${i}<T>(T x) { return ${i === 15 ? '15' : `L${i + 1}(new Box<T>(x))`}; }`);
  assert.deepEqual(linesOf(program(ladder.join(' '), 'Console.WriteLine(L0(1));')), ['15']);
});
