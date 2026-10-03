/**
 * Differential fixtures for the awaitable pattern (C# 5, SF-A02-T58): `await` over a type with `GetAwaiter()` (an
 * instance or an extension method) whose awaiter has `IsCompleted`, `GetResult()` and implements `INotifyCompletion`;
 * the diagnostics for each missing or unsuitable piece; and where `await` may be written.
 * An awaiter whose `IsCompleted` is the constant `true` runs (its `OnCompleted` is never called on .NET either).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('awaitable-pattern', [
    out(
      'completed-awaiters-instance-and-extension',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        using System.Threading.Tasks;
        class Awaiter : INotifyCompletion
        {
            readonly int value;
            public Awaiter(int value) { this.value = value; }
            public bool IsCompleted { get { return true; } }
            public void OnCompleted(Action continuation) { Console.WriteLine("never"); continuation(); }
            public int GetResult() { Console.WriteLine("GetResult " + value); return value * 2; }
        }
        class Awaitable
        {
            readonly int value;
            public Awaitable(int value) { this.value = value; }
            public Awaiter GetAwaiter() { Console.WriteLine("GetAwaiter " + value); return new Awaiter(value); }
        }
        class Signal { }
        class SignalAwaiter : ICriticalNotifyCompletion
        {
            public bool IsCompleted => true;
            public void OnCompleted(Action continuation) { }
            public void UnsafeOnCompleted(Action continuation) { }
            public void GetResult() { Console.WriteLine("signalled"); }
        }
        static class Extensions
        {
            public static SignalAwaiter GetAwaiter(this Signal signal) { return new SignalAwaiter(); }
        }
        class Program
        {
            static Awaitable Make(int value) { Console.WriteLine("Make " + value); return new Awaitable(value); }
            static async Task<int> Run()
            {
                int x = await new Awaitable(1);
                int y = await Make(2) + await Make(3);
                await new Signal();
                await Task.Delay(1);
                Func<Task<int>> lambda = async () => await new Awaitable(4) + 1;
                return x + y + await lambda();
            }
            static async Task Main()
            {
                Console.WriteLine(await Run());
            }
        }
      `,
    ),
    diag(
      'cs0117-cs4011-cs4027-cs1986-each-missing-piece',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        using System.Threading.Tasks;
        class NoIsCompleted : INotifyCompletion { public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
        class NoGetResult : INotifyCompletion { public bool IsCompleted => true; public void OnCompleted(Action c) { } }
        class NoNotify { public bool IsCompleted => true; public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
        class FieldIsCompleted : INotifyCompletion { public bool IsCompleted; public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
        class IntIsCompleted : INotifyCompletion { public int IsCompleted => 1; public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
        class ArgGetResult : INotifyCompletion { public bool IsCompleted => true; public void OnCompleted(Action c) { } public int GetResult(int x) { return 1; } }
        class PrivateGetResult : INotifyCompletion { public bool IsCompleted => true; public void OnCompleted(Action c) { } int GetResult() { return 1; } }
        class StaticIsCompleted : INotifyCompletion { public static bool IsCompleted => true; public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
        class A1 { public NoIsCompleted GetAwaiter() { return null; } }
        class A2 { public NoGetResult GetAwaiter() { return null; } }
        class A3 { public NoNotify GetAwaiter() { return null; } }
        class A4 { public FieldIsCompleted GetAwaiter() { return null; } }
        class A5 { public IntIsCompleted GetAwaiter() { return null; } }
        class A6 { public ArgGetResult GetAwaiter() { return null; } }
        class A7 { public PrivateGetResult GetAwaiter() { return null; } }
        class A8 { public StaticIsCompleted GetAwaiter() { return null; } }
        class A9 { public int GetAwaiter; }
        class A10 { public void GetAwaiter() { } }
        class A11 { public int GetAwaiter(int x) { return 1; } }
        class A12 { public static TaskAwaiter GetAwaiter() { return default; } }
        class A13 { TaskAwaiter GetAwaiter() { return default; } }
        class A14 { public int GetAwaiter() { return 1; } }
        class Program
        {
            static async Task Run()
            {
                await new A1(); await new A2(); await new A3(); await new A4(); await new A5(); await new A6(); await new A7();
                await new A8(); await new A9(); await new A10(); await new A11(); await new A12(); await new A13(); await new A14();
                await 1; await "s"; await null; await Run; await (() => 1); await default; await new object();
                int i = await Task.FromResult("s");
            }
            static void Main() { }
        }
      `,
    ),
    diag(
      'cs0815-void-result-and-forwarding-to-task-awaiters',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        using System.Threading.Tasks;
        struct VoidAwaiter : ICriticalNotifyCompletion
        {
            public bool IsCompleted => true;
            public void OnCompleted(Action continuation) { }
            public void UnsafeOnCompleted(Action continuation) { }
            public void GetResult() { }
        }
        class Thing { }
        static class Extensions
        {
            public static VoidAwaiter GetAwaiter(this Thing t) { return new VoidAwaiter(); }
            public static TaskAwaiter<int> GetAwaiter(this int i) { return Task.FromResult(i).GetAwaiter(); }
            public static TaskAwaiter GetAwaiter(this TimeSpan span) { return Task.Delay(span).GetAwaiter(); }
        }
        class Program
        {
            static async Task Run()
            {
                await new Thing();
                int v = await 5;
                string s = await 6;
                var w = await new Thing();
                await TimeSpan.FromSeconds(1);
                Console.WriteLine(v + s);
            }
            static void Main() { Run().Wait(); }
        }
      `,
    ),
    diag(
      'cs4032-cs4033-cs4034-cs1996-cs4004-where-await-is-allowed',
      cs`
        using System;
        using System.Threading.Tasks;
        class Program
        {
            static int F() { return await Task.FromResult(1); }
            static void G() { await Task.Delay(1); }
            static Task<int> H() { return await Task.FromResult(1); }
            static async void V() { await Task.Delay(1); }
            static async int Bad() { return await Task.FromResult(1); }
            static async Task<int> NoReturn() { await Task.Delay(1); }
            static void L()
            {
                Func<int> f = () => await Task.FromResult(1);
                Func<Task<int>> g = async () => await Task.FromResult(1);
                Action a = async () => await Task.Delay(1);
                Func<int, Task<int>> k = async x => { await Task.Delay(1); return x; };
                int Local() { return await Task.FromResult(1); }
                async Task<int> LocalAsync() { return await Task.FromResult(1); }
            }
            static async Task M()
            {
                lock (new object()) { await Task.Delay(1); }
                unsafe { await Task.Delay(1); }
                int[] values = { await Task.FromResult(1) };
                var s = (await Task.FromResult("x")).Length;
            }
            int P { get { return await Task.FromResult(1); } }
            static void Main() { }
        }
      `,
    ),
  ]),
];
