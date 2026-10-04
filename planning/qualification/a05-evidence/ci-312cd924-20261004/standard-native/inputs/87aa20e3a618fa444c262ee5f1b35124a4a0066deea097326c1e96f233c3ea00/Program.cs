using System;
using System.Threading;
using System.Threading.Tasks;

class Gate { }
static class Program
{
    static Gate gate = new Gate();
    static int calls;
    static Gate Get() { calls++; return gate; }
    static int ReturnInsideLock() { lock (gate) { return 7; } }

    static void Locks()
    {
        lock (Get())
        {
            Console.WriteLine(Monitor.IsEntered(gate));
            lock (gate) { Console.WriteLine(Monitor.IsEntered(gate)); }
        }
        Console.WriteLine(Monitor.IsEntered(gate));
        Console.WriteLine(calls);
        Console.WriteLine(ReturnInsideLock());
        Console.WriteLine(Monitor.IsEntered(gate));
        try { lock (gate) { throw new InvalidOperationException("saved"); } }
        catch (InvalidOperationException) { Console.WriteLine("caught"); }
        Console.WriteLine(Monitor.IsEntered(gate));
        bool taken = false;
        Monitor.Enter(gate, ref taken);
        Console.WriteLine(taken);
        Monitor.Exit(gate);
        try { Monitor.Exit(gate); } catch (SynchronizationLockException) { Console.WriteLine("unowned"); }
        try { Monitor.Enter(null); } catch (ArgumentNullException) { Console.WriteLine("null"); }
        taken = true;
        try { Monitor.Enter(gate, ref taken); } catch (ArgumentException) { Console.WriteLine("flag"); }
        Console.WriteLine(Monitor.IsEntered(gate));
    }

    static void Atomics()
    {
        int value = 1;
        Console.WriteLine(Interlocked.Increment(ref value));
        Console.WriteLine(Interlocked.CompareExchange(ref value, 7, 2));
        Console.WriteLine(value);
        Console.WriteLine(Interlocked.Add(ref value, 3));
        bool flag = false;
        Volatile.Write(ref flag, true);
        Console.WriteLine(Volatile.Read(ref flag));
        Thread.MemoryBarrier();
        Interlocked.MemoryBarrier();
        string text = "first";
        Console.WriteLine(Interlocked.Exchange<string>(ref text, "second"));
        Console.WriteLine(Interlocked.CompareExchange<string>(ref text, "third", "second"));
        Console.WriteLine(Volatile.Read<string>(ref text));
        Volatile.Write<string>(ref text, "fourth");
        Console.WriteLine(text);
    }

    static void Queues()
    {
        Gate queue = new Gate();
        int turn = 0;
        Action action = () => {
            lock (queue)
            {
                while (turn == 0) Monitor.Wait(queue);
                Console.WriteLine(turn);
                turn = 2;
                Monitor.Pulse(queue);
            }
        };
        Task first = Task.Run(action);
        Task second = Task.Run(() => {
            lock (queue)
            {
                turn = 1;
                Monitor.Pulse(queue);
                while (turn != 2) Monitor.Wait(queue);
                Console.WriteLine(turn);
            }
        });
        first.Wait();
        second.Wait();
        Console.WriteLine(Monitor.IsEntered(queue));
    }

    static void Main()
    {
        Locks();
        Atomics();
        Queues();
    }
}
