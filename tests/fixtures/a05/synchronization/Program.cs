using System;
using System.Threading;

class SynchronizationReference
{
    static object gate = new object();
    static int phase;
    static int counter;
    static long published;

    static void Ping()
    {
        for (int i = 0; i < 3; i++)
        {
            Monitor.Enter(gate);
            while (phase % 2 != 1) Monitor.Wait(gate);
            Console.WriteLine(phase);
            phase++;
            Monitor.Pulse(gate);
            Monitor.Exit(gate);
        }
    }

    static void Count()
    {
        for (int i = 0; i < 1000; i++) Interlocked.Increment(ref counter);
    }

    static void Main()
    {
        Monitor.Enter(gate);
        Monitor.Enter(gate);
        Console.WriteLine(Monitor.Wait(gate, 0));
        Monitor.Exit(gate);
        Console.WriteLine(Monitor.IsEntered(gate));
        Monitor.Exit(gate);
        Console.WriteLine(Monitor.IsEntered(gate));
        try { Monitor.Exit(gate); }
        catch (Exception error) { Console.WriteLine(error.GetType().Name); }

        bool taken = false;
        Monitor.Enter(gate, ref taken);
        Console.WriteLine(taken);
        Monitor.Exit(gate);

        Thread ping = new Thread(Ping);
        ping.Start();
        for (int i = 0; i < 3; i++)
        {
            Monitor.Enter(gate);
            while (phase % 2 != 0) Monitor.Wait(gate);
            Console.WriteLine(phase);
            phase++;
            Monitor.Pulse(gate);
            Monitor.Exit(gate);
        }
        ping.Join();

        Thread first = new Thread(Count);
        Thread second = new Thread(Count);
        first.Start();
        second.Start();
        first.Join();
        second.Join();
        Console.WriteLine(counter);

        long wide = 9223372036854775807L;
        Console.WriteLine(Interlocked.Increment(ref wide));
        Console.WriteLine(Interlocked.CompareExchange(ref wide, 42L, -9223372036854775808L));
        Console.WriteLine(wide);
        int mask = 15;
        Console.WriteLine(Interlocked.And(ref mask, 3));
        Console.WriteLine(Interlocked.Or(ref mask, 8));
        Console.WriteLine(mask);

        double zero = -0.0;
        Interlocked.CompareExchange(ref zero, 1.0, 0.0);
        Console.WriteLine(BitConverter.DoubleToInt64Bits(zero));
        Interlocked.CompareExchange(ref zero, 1.0, -0.0);
        Console.WriteLine(zero);

        Volatile.Write(ref published, 9223372036854775807L);
        Console.WriteLine(Volatile.Read(ref published));
        Interlocked.MemoryBarrier();
    }
}
