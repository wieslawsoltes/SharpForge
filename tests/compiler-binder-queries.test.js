import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

// A query pattern whose methods record their own name and one sample result of each lambda they receive.
const tracing = `
  class Seq {
    string trace;
    public Seq(string trace) { this.trace = trace; }
    public string Trace { get { return trace; } }
    Seq Next(string step) { return new Seq(trace + "." + step); }
    public Seq Where(Func<int, bool> p) { return Next("Where(" + p(3) + ")"); }
    public Seq Select(Func<int, int> s) { return Next("Select(" + s(3) + ")"); }
    public Seq SelectMany(Func<int, Seq> c, Func<int, int, int> r) { return Next("SelectMany(" + c(1).Trace + "," + r(2, 5) + ")"); }
    public Seq Join(Seq inner, Func<int, int> o, Func<int, int> i, Func<int, int, int> r) {
      return Next("Join(" + inner.Trace + "," + o(1) + "," + i(2) + "," + r(3, 4) + ")");
    }
    public Seq OrderBy(Func<int, int> k) { return Next("OrderBy(" + k(3) + ")"); }
    public Seq ThenByDescending(Func<int, int> k) { return Next("ThenByDescending(" + k(3) + ")"); }
    public Seq GroupBy(Func<int, int> k) { return Next("GroupBy(" + k(3) + ")"); }
    public Seq GroupBy(Func<int, int> k, Func<int, int> e) { return Next("GroupBy(" + k(3) + "," + e(3) + ")"); }
  }`;
const chainOf = query =>
  linesOf(`using System;${tracing}
    class Program { static void Main() { var a = new Seq("a"); var b = new Seq("b"); int k = 10; Console.WriteLine((${query}).Trace); } }`)[0];

const generic = `
  class Seq<T> {
    public Seq<T> Where(Func<T, bool> p) { return this; }
    public Seq<R> Select<R>(Func<T, R> s) { return new Seq<R>(); }
    public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> c, Func<T, C, R> r) { return new Seq<R>(); }
    public Seq<R> Join<I, K, R>(Seq<I> inner, Func<T, K> o, Func<I, K> i, Func<T, I, R> r) { return new Seq<R>(); }
    public Seq<T> OrderBy<K>(Func<T, K> k) { return this; }
  }
  class Plain { }`;
const typed = statements => `using System;${generic}
  class Program { static void Main() { var a = new Seq<int>(); var b = new Seq<string>(); ${statements} } }`;
const errorsOf = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${d.message}`);

test('SF-A02-T09.5 select and where: a degenerate select is kept alone and dropped after another clause', () => {
  assert.equal(chainOf('from x in a select x'), 'a.Select(3)');
  assert.equal(chainOf('from x in a where x > 2 select x'), 'a.Where(True)');
  assert.equal(chainOf('from x in a where x > 2 select x * k'), 'a.Where(True).Select(30)');
});

test('SF-A02-T09.5 a second from and a join take the select as their result selector', () => {
  assert.equal(chainOf('from x in a from y in b select x + y'), 'a.SelectMany(b,7)');
  assert.equal(chainOf('from x in a join y in b on x + 1 equals y * 2 select x * y'), 'a.Join(b,2,4,12)');
});

test('SF-A02-T09.5 orderby, group by and continuations', () => {
  assert.equal(chainOf('from x in a orderby x, -x descending select x'), 'a.OrderBy(3).ThenByDescending(-3)');
  assert.equal(chainOf('from x in a group x by x % 2'), 'a.GroupBy(1)');
  assert.equal(chainOf('from x in a group x * 2 by x % 2'), 'a.GroupBy(1,6)');
  assert.equal(chainOf('from x in a select x + 1 into y where y > 3 select y * k'), 'a.Select(4).Where(False).Select(30)');
});

test('SF-A02-T09.5 transparent identifiers carry every range variable through let, from and join', () => {
  const valid = typed(`
    Seq<string> q1 = from x in a let y = x * 2 where y > x select "v" + (x + y);
    Seq<int> q2 = from x in a from s in b where s.Length > x let z = s + x orderby z select x + s.Length + z.Length;
    Seq<bool> q3 = from x in a join s in b on x equals s.Length where x > 1 select s == "a";`);
  assert.deepEqual(errorsOf(valid), []);
  const wrong = errorsOf(typed('int e = from x in a from s in b let n = s.Length where n > x select n > 1;'));
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /CS0029 Cannot implicitly convert type 'Seq<bool>' to 'int'/);
  // The program binds; running it needs user-defined generics.
  assert.match(notExecutable(valid).message, /user-defined generics/);
});

test('SF-A02-T09.5 query diagnostics: missing pattern, join keys and errors inside clauses', () => {
  const codes = statements => errorsOf(typed(statements)).map(text => text.slice(0, 6));
  assert.deepEqual(codes('var q = from x in new Plain() select x;'), ['CS1936']);
  assert.deepEqual(codes('var q = from x in a group x by x;'), ['CS1936']);
  assert.deepEqual(codes('var q = from x in a join s in b on x equals s select x;'), ['CS1941']);
  assert.deepEqual(codes('var q = from x in a where x select x;'), ['CS0029']);
  assert.deepEqual(codes('var q = from x in a let y = x select y.Missing;'), ['CS1061']);
  assert.deepEqual(codes('var q = from x in a where missing > x select x;'), ['CS0103']);
});
