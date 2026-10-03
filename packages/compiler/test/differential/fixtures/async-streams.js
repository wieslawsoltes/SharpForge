/**
 * Differential fixtures for SF-A02-T09.4: async iterators, `await foreach`, `await using`, using declarations and
 * the async-stream diagnostics.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('async-streams', [
    out(
      'async-iterator-and-await-foreach',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        static async IAsyncEnumerable<int> Numbers(int count)
        {
            Console.WriteLine("numbers start");
            try
            {
                for (int i = 1; i <= count; i++)
                {
                    await Task.Delay(1);
                    yield return i;
                }
            }
            finally
            {
                await Task.Yield();
                Console.WriteLine("numbers finally");
            }
        }
        static async IAsyncEnumerable<string> Words()
        {
            yield return "a";
            await Task.Delay(1);
            yield return "b";
            await foreach (int n in Numbers(2)) yield return "n" + n;
        }
        static async Task Main()
        {
            Func<int, int> twice = x => x * 2;
            await foreach (int n in Numbers(3)) Console.WriteLine(twice(n));
            Console.WriteLine("--- early break");
            await foreach (int n in Numbers(5)) { Console.WriteLine(n); if (n == 2) break; }
            Console.WriteLine("--- nested");
            await foreach (string w in Words()) Console.WriteLine(w);
        }
    }
  `,
    ),
    out(
      'manual-async-enumerator',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        static async IAsyncEnumerable<int> Numbers(int count)
        {
            Console.WriteLine("numbers start");
            try
            {
                for (int i = 1; i <= count; i++)
                {
                    await Task.Delay(1);
                    yield return i;
                }
            }
            finally
            {
                await Task.Yield();
                Console.WriteLine("numbers finally");
            }
        }
        static async Task Main()
        {
            IAsyncEnumerator<int> e = Numbers(2).GetAsyncEnumerator();
            while (await e.MoveNextAsync()) Console.WriteLine("manual " + e.Current);
            await e.DisposeAsync();
            var early = Numbers(3).GetAsyncEnumerator();
            Console.WriteLine(await early.MoveNextAsync());
            await early.DisposeAsync();
            Console.WriteLine(await early.MoveNextAsync());
            var fresh = Numbers(3).GetAsyncEnumerator();
            await fresh.DisposeAsync();
            Console.WriteLine(await fresh.MoveNextAsync());
        }
    }
  `,
    ),
    out(
      'await-foreach-over-a-pattern',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Ticker
    {
        int limit;
        public Ticker(int limit) { this.limit = limit; }
        public TickerEnumerator GetAsyncEnumerator() { return new TickerEnumerator(limit); }
    }
    class TickerEnumerator
    {
        int limit, value;
        public TickerEnumerator(int limit) { this.limit = limit; }
        public int Current { get { return value; } }
        public async ValueTask<bool> MoveNextAsync() { await Task.Delay(1); value++; return value <= limit; }
        public async ValueTask DisposeAsync() { await Task.Yield(); Console.WriteLine("ticker disposed"); }
    }
    class Program
    {
        static async IAsyncEnumerable<int> Doubled(Ticker ticker)
        {
            await foreach (int t in ticker) yield return t * 2;
        }
        static async Task Main()
        {
            await foreach (int t in new Ticker(2)) Console.WriteLine("tick " + t);
            await foreach (int t in new Ticker(5)) { if (t == 2) break; }
            await foreach (int d in Doubled(new Ticker(3))) { Console.WriteLine(d); if (d == 4) break; }
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'await-using-and-using-declarations',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Res : IAsyncDisposable
    {
        string name;
        public Res(string name) { this.name = name; Console.WriteLine("open " + name); }
        public async ValueTask DisposeAsync() { await Task.Delay(1); Console.WriteLine("close " + name); }
    }
    class Plain : IDisposable
    {
        string name;
        public Plain(string name) { this.name = name; }
        public void Dispose() { Console.WriteLine("disposed " + name); }
    }
    class Program
    {
        static IEnumerable<int> Guarded()
        {
            using var guard = new Plain("guard");
            yield return 1;
            yield return 2;
        }
        static async Task<int> Work(bool fail)
        {
            await using var first = new Res("first");
            await using (var second = new Res("second"))
            {
                Console.WriteLine("inside second");
                if (fail) throw new Exception("failed");
            }
            using var plain = new Plain("plain");
            Console.WriteLine("after second");
            return 7;
        }
        static async Task Main()
        {
            Console.WriteLine(await Work(false));
            try { await Work(true); } catch (Exception e) { Console.WriteLine("caught " + e.Message); }
            foreach (int g in Guarded()) { Console.WriteLine(g); break; }
        }
    }
  `,
    ),
    diag(
      'cs8403-async-iterator-without-async',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        static IAsyncEnumerable<int> Numbers() { yield return 1; }
        static IAsyncEnumerator<int> Enumerator() { yield break; }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs8414-foreach-over-async-stream',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        static async IAsyncEnumerable<int> Numbers() { await Task.Delay(1); yield return 1; }
        static IEnumerable<int> Sync() { yield return 1; }
        static async Task Work() { foreach (int x in Numbers()) { } await Task.Delay(1); }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs8415-cs8411-await-foreach-over-sync',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        static async IAsyncEnumerable<int> Numbers() { await Task.Delay(1); yield return 1; }
        static IEnumerable<int> Sync() { yield return 1; }
        static async Task Work()
        {
            await foreach (int x in Sync()) { }
            await foreach (int y in 5) { }
            await foreach (string s in Numbers()) { }
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs8418-cs8410-wrong-using-form',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Res : IAsyncDisposable
    {
        public ValueTask DisposeAsync() { return default; }
    }
    class Program
    {
        static async Task Work()
        {
            using (var r = new Res()) { }
            await using (var s = "text") { }
            await Task.Delay(1);
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs4033-cs4032-await-statements-outside-async',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Res : IAsyncDisposable
    {
        public ValueTask DisposeAsync() { return default; }
    }
    class Program
    {
        static async IAsyncEnumerable<int> Numbers() { await Task.Delay(1); yield return 1; }
        static void Statements()
        {
            await foreach (int x in Numbers()) { }
            await using (var r = new Res()) { }
        }
        static Task<int> Declaration()
        {
            await using var r = new Res();
            return null;
        }
        static void Main() { }
    }
  `,
    ),
  ]),
];
