/**
 * Differential fixtures for SF-A02-T09.2 and T09.3: async methods, lambdas and local functions lowered from bound
 * trees (the programs use delegates, closures or properties, so they are outside the string-typed profile), the
 * evaluation order around `await`, `await` in try/catch/finally, and the async diagnostics.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('async-lowering', [
    out(
      'methods-start-eagerly-and-return-results',
      cs`
    using System;
    using System.Threading.Tasks;
    delegate int Twice(int x);
    class Worker
    {
        int bias;
        public Worker(int bias) { this.bias = bias; }
        public async Task<int> AddAsync(int a, int b)
        {
            Console.WriteLine("add start " + a);
            await Task.Delay(1);
            Console.WriteLine("add end " + a);
            return a + b + bias;
        }
    }
    class Program
    {
        static async Task Log(string text)
        {
            await Task.Yield();
            Console.WriteLine("log " + text);
        }
        static async Task Main()
        {
            Twice twice = x => x * 2;
            var worker = new Worker(100);
            Task<int> pending = worker.AddAsync(1, 2);
            Console.WriteLine("after call");
            Console.WriteLine(await pending);
            Console.WriteLine(twice(await worker.AddAsync(3, 4)));
            await Log("one");
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'evaluation-order-around-await',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static int[] cells = new int[3];
        static int Trace(int v) { Console.WriteLine("eval " + v); return v; }
        static async Task<int> Slow(int v) { await Task.Delay(1); Console.WriteLine("slow " + v); return v; }
        static int Sum(int a, int b, int c) { return a + b + c; }
        static async Task Main()
        {
            Func<int, int> id = x => x;
            Console.WriteLine(Trace(1) + await Slow(Trace(2)) + Trace(3));
            Console.WriteLine(Sum(Trace(4), await Slow(5), id(Trace(6))));
            cells[Trace(1)] = await Slow(7);
            cells[Trace(2)] += await Slow(8) + Trace(9);
            Console.WriteLine(cells[1] + " " + cells[2]);
            string text = "a" + Trace(10) + await Slow(11) + Trace(12);
            Console.WriteLine(text);
        }
    }
  `,
    ),
    out(
      'await-in-try-catch-finally',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static async Task<string> Describe(string name)
        {
            try
            {
                await Task.Delay(1);
                if (name == "bad") throw new Exception("bad name");
                return "ok " + name;
            }
            finally
            {
                await Task.Yield();
                Console.WriteLine("described " + name);
            }
        }
        static async Task<int> Recover()
        {
            int attempts = 0;
            while (true)
            {
                try
                {
                    attempts++;
                    await Describe(attempts < 3 ? "bad" : "good");
                    return attempts;
                }
                catch (Exception e)
                {
                    await Task.Delay(1);
                    Console.WriteLine("retry after " + e.Message);
                }
            }
        }
        static async Task Main()
        {
            Func<string, string> mark = s => s + "!";
            Console.WriteLine(mark(await Describe("x")));
            try { await Describe("bad"); }
            catch (Exception e) { Console.WriteLine("caught " + e.Message); }
            Console.WriteLine(await Recover());
        }
    }
  `,
    ),
    out(
      'async-lambdas-and-local-functions',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        int seed = 3;
        async Task<int> Run()
        {
            Func<int, Task<int>> square = async v => { await Task.Delay(1); return v * v; };
            Console.WriteLine(await square(7));
            int captured = 5;
            Func<Task> bump = async () => { await Task.Yield(); captured += seed; };
            await bump();
            await bump();
            async Task<int> Local(int k) { await Task.Delay(1); return k + captured + seed; }
            return await Local(10);
        }
        static async Task Main()
        {
            Console.WriteLine(await new Program().Run());
            Action<string> fire = async text =>
            {
                Console.WriteLine("fire " + text);
                await Task.Delay(1);
                Console.WriteLine("fired " + text);
            };
            fire("x");
            Console.WriteLine("between");
            await Task.Delay(20);
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'top-level-await-value-tasks-and-loops',
      cs`
    using System;
    using System.Threading.Tasks;

    Func<int, int> twice = x => x * 2;
    Console.WriteLine(await Scale(3, twice));
    Console.WriteLine(await Quick(4));
    await Slow();
    var holder = new Holder();
    await holder.Fill(5);
    Console.WriteLine(holder.Total);
    Task<int>[] pending = { Scale(1, twice), Scale(2, twice) };
    int sum = 0;
    foreach (Task<int> task in pending) sum += await task;
    Console.WriteLine(sum);
    Console.WriteLine(await Loop(4));

    static async Task<int> Scale(int v, Func<int, int> f) { await Task.Yield(); return f(v); }
    static async ValueTask<int> Quick(int v) { await Task.Delay(1); return v + 1; }
    static async ValueTask Slow() { await Task.Delay(2); Console.WriteLine("slow"); }
    static async Task<int> Loop(int count)
    {
        int total = 0;
        for (int i = 0; i < count; i++)
        {
            total += await Quick(i);
            if (i == 2) continue;
            await Task.Yield();
        }
        return total;
    }

    class Holder
    {
        public int Total { get; private set; }
        public async Task Fill(int count)
        {
            for (int i = 1; i <= count; i++)
            {
                await Task.Yield();
                Total += i;
            }
        }
    }
  `,
    ),
    out(
      'async-void-and-faulted-tasks',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static event Action Done;
        static async void Fire(string text)
        {
            Console.WriteLine("fire " + text);
            await Task.Delay(1);
            Console.WriteLine("fired " + text);
            if (Done != null) Done();
        }
        static async Task<int> Fails(bool late)
        {
            if (!late) throw new Exception("early");
            await Task.Delay(1);
            throw new Exception("late");
        }
        static async Task Main()
        {
            Done += () => Console.WriteLine("handler ran");
            Fire("a");
            Console.WriteLine("returned");
            await Task.Delay(5);
            Task<int> early = Fails(false);
            Console.WriteLine("early is faulted: " + early.IsFaulted);
            try { await early; } catch (Exception e) { Console.WriteLine(e.Message); }
            try { Console.WriteLine(await Fails(true)); } catch (Exception e) { Console.WriteLine(e.Message); }
        }
    }
  `,
    ),
    diag(
      'cs1988-by-reference-parameters',
      cs`
    using System.Threading.Tasks;
    class Program
    {
        static async Task Work(ref int a, out int b, in int c) { b = 0; await Task.Delay(1); }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1996-await-in-lock',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static async Task Work(object gate)
        {
            lock (gate) { await Task.Delay(1); }
            lock (gate) { Func<Task> later = async () => await Task.Delay(1); }
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1997-value-from-task-method',
      cs`
    using System.Threading.Tasks;
    class Program
    {
        static async Task Work() { await Task.Delay(1); return 1; }
        static async Task<int> Missing() { await Task.Delay(1); }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs4032-cs4034-await-outside-async',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static Task<int> Method() { await Task.Delay(1); return null; }
        static void Lambda() { Func<int> g = () => { await Task.Delay(1); return 1; }; }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1061-await-of-a-value-without-awaiter',
      cs`
    using System.Threading.Tasks;
    class Plain { }
    class Program
    {
        static async Task Work() { await 5; await new Plain(); await Task.Delay(1); }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs4014-unawaited-call-in-async-lambda',
      cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static async Task Work() { await Task.Delay(1); }
        static async Task Main()
        {
            Func<Task> run = async () => { Work(); await Task.Delay(1); };
            await run();
            Work();
        }
    }
  `,
    ),
  ]),
];
