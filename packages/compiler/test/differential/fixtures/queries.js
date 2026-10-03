/**
 * Differential fixtures for SF-A02-T09.5: query expressions translated to method calls. The output fixture runs
 * queries against a user-defined query pattern whose methods record their name and what their lambdas compute, so
 * the printed chain is the translation; .NET prints the chain Roslyn produced. The diagnostics fixtures use a generic
 * pattern, where transparent identifiers decide the types.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('queries', [
    out(
      'method-chains-of-each-clause',
      cs`
    using System;
    class Seq
    {
        string trace;
        public Seq(string trace) { this.trace = trace; }
        public string Trace { get { return trace; } }
        Seq Next(string step) { return new Seq(trace + "." + step); }
        public Seq Where(Func<int, bool> predicate) { return Next("Where(" + predicate(3) + ")"); }
        public Seq Select(Func<int, int> selector) { return Next("Select(" + selector(3) + ")"); }
        public Seq SelectMany(Func<int, Seq> collection, Func<int, int, int> result)
        {
            return Next("SelectMany(" + collection(1).Trace + "," + result(2, 5) + ")");
        }
        public Seq Join(Seq inner, Func<int, int> outerKey, Func<int, int> innerKey, Func<int, int, int> result)
        {
            return Next("Join(" + inner.Trace + "," + outerKey(1) + "," + innerKey(2) + "," + result(3, 4) + ")");
        }
        public Seq GroupJoin(Seq inner, Func<int, int> outerKey, Func<int, int> innerKey, Func<int, Seq, int> result)
        {
            return Next("GroupJoin(" + inner.Trace + "," + outerKey(1) + "," + innerKey(2) + "," + result(3, inner) + ")");
        }
        public Seq OrderBy(Func<int, int> key) { return Next("OrderBy(" + key(3) + ")"); }
        public Seq OrderByDescending(Func<int, int> key) { return Next("OrderByDescending(" + key(3) + ")"); }
        public Seq ThenBy(Func<int, int> key) { return Next("ThenBy(" + key(3) + ")"); }
        public Seq ThenByDescending(Func<int, int> key) { return Next("ThenByDescending(" + key(3) + ")"); }
        public Seq GroupBy(Func<int, int> key) { return Next("GroupBy(" + key(3) + ")"); }
        public Seq GroupBy(Func<int, int> key, Func<int, int> element) { return Next("GroupBy(" + key(3) + "," + element(3) + ")"); }
    }
    class Program
    {
        static void Main()
        {
            var a = new Seq("a");
            var b = new Seq("b");
            int k = 10;
            Console.WriteLine((from x in a select x).Trace);
            Console.WriteLine((from x in a where x > 2 select x).Trace);
            Console.WriteLine((from x in a where x > 2 select x * k).Trace);
            Console.WriteLine((from x in a from y in b select x + y).Trace);
            Console.WriteLine((from x in a join y in b on x + 1 equals y * 2 select x * y).Trace);
            Console.WriteLine((from x in a join y in b on x equals y into g select x + g.Trace.Length).Trace);
            Console.WriteLine((from x in a orderby x, -x descending, x * 2 select x).Trace);
            Console.WriteLine((from x in a orderby x descending select x + 1).Trace);
            Console.WriteLine((from x in a group x by x % 2).Trace);
            Console.WriteLine((from x in a group x * 2 by x % 2).Trace);
            Console.WriteLine((from x in a where x > 0 select x + 1 into y where y > 3 select y * k).Trace);
            Console.WriteLine((from x in a select x into y select y).Trace);
            Console.WriteLine((from x in a where x > k select x into y group y by y + 1 into g select g + k).Trace);
            Func<Seq, Seq> nested = s => from x in s where (from y in b select y + x).Trace.Length > 3 select x;
            Console.WriteLine(nested(a).Trace);
        }
    }
  `,
    ),
    diag(
      'transparent-identifiers-decide-result-types',
      cs`
    using System;
    class Seq<T>
    {
        public Seq<T> Where(Func<T, bool> predicate) { return this; }
        public Seq<R> Select<R>(Func<T, R> selector) { return new Seq<R>(); }
        public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> collection, Func<T, C, R> result) { return new Seq<R>(); }
        public Seq<R> Join<I, K, R>(Seq<I> inner, Func<T, K> outerKey, Func<I, K> innerKey, Func<T, I, R> result) { return new Seq<R>(); }
        public Seq<T> OrderBy<K>(Func<T, K> key) { return this; }
        public Seq<R> Cast<R>() { return new Seq<R>(); }
    }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var a = new Seq<int>();
            var b = new Seq<string>();
            Seq<string> q1 = from x in a let y = x * 2 where y > x select "v" + (x + y);
            Seq<int> q2 = from x in a from s in b where s.Length > x let z = s + x orderby z select x + s.Length + z.Length;
            Seq<bool> q3 = from x in a join s in b on x equals s.Length where x > 1 select s == "a";
            Seq<long> q4 = from long l in a select l;
            int e1 = from x in a let y = "t" + x select y;
            int e2 = from x in a from s in b let n = s.Length where n > x select n > 1;
            int e3 = from x in a join s in b on x equals s.Length let d = 1.5 select d;
        }
    }
  `,
    ),
    diag(
      'cs1936-no-query-pattern',
      cs`
    using System;
    class Seq<T>
    {
        public Seq<T> Where(Func<T, bool> predicate) { return this; }
        public Seq<R> Select<R>(Func<T, R> selector) { return new Seq<R>(); }
        public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> collection, Func<T, C, R> result) { return new Seq<R>(); }
        public Seq<R> Join<I, K, R>(Seq<I> inner, Func<T, K> outerKey, Func<I, K> innerKey, Func<T, I, R> result) { return new Seq<R>(); }
        public Seq<T> OrderBy<K>(Func<T, K> key) { return this; }
        public Seq<R> Cast<R>() { return new Seq<R>(); }
    }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var a = new Seq<int>();
            var b = new Seq<string>();
            var q1 = from x in new Plain() select x;
            var q2 = from x in 5 select x;
            var q3 = from x in a group x by x;
        }
    }
  `,
    ),
    diag(
      'cs1941-join-key-types',
      cs`
    using System;
    class Seq<T>
    {
        public Seq<T> Where(Func<T, bool> predicate) { return this; }
        public Seq<R> Select<R>(Func<T, R> selector) { return new Seq<R>(); }
        public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> collection, Func<T, C, R> result) { return new Seq<R>(); }
        public Seq<R> Join<I, K, R>(Seq<I> inner, Func<T, K> outerKey, Func<I, K> innerKey, Func<T, I, R> result) { return new Seq<R>(); }
        public Seq<T> OrderBy<K>(Func<T, K> key) { return this; }
        public Seq<R> Cast<R>() { return new Seq<R>(); }
    }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var a = new Seq<int>();
            var b = new Seq<string>();
            var q = from x in a join s in b on x equals s select x;
        }
    }
  `,
    ),
    diag(
      'errors-inside-clause-expressions',
      cs`
    using System;
    class Seq<T>
    {
        public Seq<T> Where(Func<T, bool> predicate) { return this; }
        public Seq<R> Select<R>(Func<T, R> selector) { return new Seq<R>(); }
        public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> collection, Func<T, C, R> result) { return new Seq<R>(); }
        public Seq<R> Join<I, K, R>(Seq<I> inner, Func<T, K> outerKey, Func<I, K> innerKey, Func<T, I, R> result) { return new Seq<R>(); }
        public Seq<T> OrderBy<K>(Func<T, K> key) { return this; }
        public Seq<R> Cast<R>() { return new Seq<R>(); }
    }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var a = new Seq<int>();
            var b = new Seq<string>();
            var q1 = from x in a where x select x;
            var q2 = from x in a let y = x select y.Missing;
            Seq<string> q3 = from x in a select x;
            var q4 = from x in a where missing > x select x;
        }
    }
  `,
    ),
  ]),
];
