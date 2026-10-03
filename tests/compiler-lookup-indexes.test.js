import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { MethodIndex } from '../packages/compiler/src/method-index.js';
import { memberPath } from '../packages/compiler/src/binder/member-path.js';
import { NamespaceSymbol } from '../packages/compiler/src/symbols/namespaces.js';
import { syntheticProgram, generatedCorpus } from '../packages/compiler/bench/synthetic-program.js';

// Lookups that used to scan every method or type of the compilation (quadratic in program size) are indexed.
// The complexity assertions count how many records a lookup touches, not wall time.

const method = (name, owner, types, extra = {}) => ({ name, owner, parameters: types.map(type => ({ type })), ...extra });

test('method index: methods are found by name in declaration order', () => {
  const index = new MethodIndex(),
    owner = { name: 'C' };
  const first = method('Run', owner, ['int']),
    second = method('Run', null, []),
    other = method('Stop', owner, []);
  for (const record of [first, other, second]) index.add(record);
  assert.deepEqual(index.named('Run'), [first, second]);
  assert.deepEqual(index.named('Stop'), [other]);
  assert.deepEqual(index.named('Missing'), []);
  assert.throws(() => index.named('Missing').push(first), TypeError, 'the empty result is shared and frozen');
});

test('method index: a duplicate is the same owner, name and parameter types', () => {
  const index = new MethodIndex(),
    owner = { name: 'C' },
    another = { name: 'D' };
  index.add(method('Run', owner, ['int', 'string']));
  index.add(method('Run', null, ['int']));
  assert.equal(index.hasSignature(method('Run', owner, ['int', 'string'])), true);
  assert.equal(index.hasSignature(method('Run', owner, ['int'])), false, 'different parameter types');
  assert.equal(index.hasSignature(method('Run', another, ['int', 'string'])), false, 'different owner');
  assert.equal(index.hasSignature(method('Run', null, ['int'])), true, 'top-level methods share the null owner');
  assert.equal(index.hasSignature(method('Walk', owner, ['int', 'string'])), false, 'different name');
});

test('method index: duplicate and overload diagnostics of the pipeline are unchanged', () => {
  const codes = source => compile(source).diagnostics.map(d => d.code);
  assert(codes('class C { static void M(int a) { } static void M(int b) { } static void Main() { } }').includes('CS0111'));
  assert(!codes('class C { static void M(int a) { } static void M(string a) { } static void Main() { M(1); M("s"); } }').includes('CS0111'));
  assert(!codes('class C { static void M() { } } class D { static void M() { } static void Main() { M(); } }').includes('CS0111'));
  const run = compile('class C { static int Twice(int x) { return x * 2; } static void Main() { Console.WriteLine(Twice(nameof(Twice).Length)); } }');
  assert.deepEqual(run.diagnostics.filter(d => d.severity === 'error'), []);
});

/** A type record whose `name` counts how often it is read. */
function countedType(name, arity, reads) {
  return {
    arity,
    get name() {
      reads.count++;
      return name;
    },
  };
}

test('namespace types: a lookup by name does not scan the namespace', () => {
  const namespace = new NamespaceSymbol(''),
    reads = { count: 0 },
    types = [];
  for (let index = 0; index < 1000; index++) types.push(namespace.addType(countedType('T' + index, index % 2, reads)));
  const generic = namespace.addType(countedType('T7', 2, reads));
  reads.count = 0;
  assert.deepEqual(namespace.getTypeMembers('T7'), [types[7], generic]);
  assert.deepEqual(namespace.getTypeMembers('T7', 2), [generic]);
  assert.deepEqual(namespace.getTypeMembers('T7', 5), []);
  assert.deepEqual(namespace.getTypeMembers('Missing'), []);
  assert.equal(reads.count, 0, 'no type name is read to answer a lookup by name');
  assert.equal(namespace.getTypeMembers().length, 1001);
  assert.equal(namespace.getTypeMembers(undefined, 2).length, 1);
  const all = namespace.getTypeMembers();
  all.length = 0;
  assert.equal(namespace.getTypeMembers().length, 1001, 'the result is a copy');
  assert.equal(namespace.lookupType('T8', 0), types[8]);
});

test('member path: the dotted path of a member chain, null for anything else', () => {
  const name = { kind: 'Name', name: 'a' },
    chain = { kind: 'Member', name: 'c', target: { kind: 'Member', name: 'b', target: name } };
  assert.equal(memberPath(name), 'a');
  assert.equal(memberPath(chain), 'a.b.c');
  assert.equal(memberPath({ kind: 'Member', name: 'x', target: { kind: 'Call' } }), null);
  assert.equal(memberPath(null), null);
});

test('type declarations: duplicates and partial types are still recognised', () => {
  const codes = source => compile(source).diagnostics.map(d => d.code);
  assert(codes('class A { } class A { } class P { static void Main() { } }').includes('CS0101'));
  assert(!codes('class A<T> { } class A { } class P { static void Main() { } }').includes('CS0101'));
  const partial = compile('partial class A { public int X; } partial class A { public int Y; } class P { static void Main() { var a = new A(); a.X = a.Y; } }');
  assert.deepEqual(partial.diagnostics.filter(d => d.severity === 'error'), []);
});

test('SuppressMessage: files that cannot mention the attribute are skipped, escaped names are not', () => {
  const attribute = '[System.Diagnostics.CodeAnalysis.SuppressMessage("Category", "Id")] class A { } class P { static void Main() { } }';
  assert.deepEqual(compile(attribute).diagnostics.filter(d => d.code === 'SF1018'), []);
  // A user type of that name keeps the rejection, also when it is declared in another file or spelled with an escape.
  const own = [
    { uri: 'A.cs', text: '[SuppressMessage("Category", "Id")] class A { } class P { static void Main() { } }' },
    { uri: 'B.cs', text: 'class SuppressMessage : System.Attribute { public SuppressMessage(string a, string b) { } }' },
  ];
  const escaped = [own[0], { uri: 'B.cs', text: own[1].text.replaceAll('SuppressMessage', '\\u0053uppressMessage') }];
  const unrelated = [own[0], { uri: 'B.cs', text: 'class Other { }' }];
  const rejections = files => compile(files).diagnostics.filter(d => d.code === 'SF1018').length;
  assert.equal(rejections(unrelated), 0);
  assert.equal(rejections(own), rejections(escaped));
  assert(rejections(own) > 0);
});

test('benchmark programs: the synthetic programs and the corpus compile as the benchmark expects', () => {
  assert.equal(compile(syntheticProgram(2, { full: false })).success, true);
  const full = compile(syntheticProgram(2));
  assert.deepEqual([...new Set(full.diagnostics.filter(d => d.severity === 'error').map(d => d.code))].filter(code => !code.startsWith('SF')), []);
  assert.equal(compile(generatedCorpus(3, 5)).success, true);
});
