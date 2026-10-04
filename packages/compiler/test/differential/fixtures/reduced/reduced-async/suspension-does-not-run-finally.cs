using System;
using System.Threading;
using System.Threading.Tasks;

// Reduced from stress-tasks/cancellation-fake-clock-downloader: when an await inside a try block suspends, the
// finally blocks around it must not run - also when another thread resumes the method before the suspending call
// has left its protected regions (the guard reads the state kept in a local, not the field the resumer writes).
public sealed class Resource : IDisposable
{
    public int Disposals;
    public void Dispose() => Interlocked.Increment(ref Disposals);
}

public static class Program
{
    private static int _early;
    private static int _finallyRuns;

    private static async Task<int> WorkAsync(int round)
    {
        using var resource = new Resource();
        int total = 0;
        try
        {
            for (int step = 0; step < 4; step++)
            {
                try
                {
                    await Task.Yield();
                    if (resource.Disposals != 0) Interlocked.Increment(ref _early);
                    total += step;
                }
                finally
                {
                    Interlocked.Increment(ref _finallyRuns);
                }
            }
            await Task.Run(() => total += round);
            if (resource.Disposals != 0) Interlocked.Increment(ref _early);
        }
        finally
        {
            Interlocked.Increment(ref _finallyRuns);
        }
        return total;
    }

    public static async Task Main()
    {
        long sum = 0;
        for (int round = 0; round < 400; round++) sum += await WorkAsync(round);
        Task<int>[] parallel = new Task<int>[64];
        for (int index = 0; index < parallel.Length; index++) parallel[index] = WorkAsync(index);
        foreach (int value in await Task.WhenAll(parallel)) sum += value;
        Console.WriteLine("sum " + sum);
        Console.WriteLine("finally blocks " + _finallyRuns);
        Console.WriteLine("disposed while suspended " + _early);
    }
}
