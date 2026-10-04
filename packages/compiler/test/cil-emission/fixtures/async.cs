using System;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;

class Resource : IDisposable
{
    readonly string name;
    public Resource(string name) { this.name = name; Console.WriteLine("open " + name); }
    public void Dispose() { Console.WriteLine("close " + name); }
}

class Signal
{
    public bool Ready;
    public int Value;
    public SignalAwaiter GetAwaiter() { return new SignalAwaiter(this); }
}

class SignalAwaiter : INotifyCompletion
{
    readonly Signal signal;
    public SignalAwaiter(Signal signal) { this.signal = signal; }
    public bool IsCompleted { get { return signal.Ready; } }
    public int GetResult() { return signal.Value; }
    public void OnCompleted(Action continuation)
    {
        Console.WriteLine("signal waits");
        signal.Ready = true;
        signal.Value += 100;
        continuation();
    }
}

struct Meter
{
    public int Reading;
    public async Task<int> ReadLater(int extra)
    {
        await Task.Yield();
        return Reading + extra;
    }
}

class Account
{
    int balance;
    public int Balance { get { return balance; } }
    public async Task<int> Deposit(int amount)
    {
        Console.WriteLine("deposit " + amount);
        await Task.Delay(1);
        balance += amount;
        return balance;
    }
    public async ValueTask<int> Fee(int rate)
    {
        await Task.Yield();
        return balance / rate;
    }
    public async ValueTask Reset()
    {
        await Task.Delay(1);
        balance = 0;
    }
}

class Program
{
    static int Trace(int value) { Console.WriteLine("eval " + value); return value; }
    static async Task<int> Slow(int value) { await Task.Delay(1); Console.WriteLine("slow " + value); return value; }
    static int Sum(int a, int b, int c) { return a + b + c; }
    static int[] cells = new int[4];

    static async Task<int> Throws(bool late)
    {
        if (!late) throw new InvalidOperationException("early");
        await Task.Delay(1);
        throw new InvalidOperationException("late");
    }

    static async Task Order()
    {
        Console.WriteLine(Trace(1) + await Slow(Trace(2)) + Trace(3));
        Console.WriteLine(Sum(Trace(4), await Slow(5), await Slow(Trace(6))));
        cells[Trace(1)] = await Slow(7);
        cells[Trace(2)] += await Slow(8) + Trace(9);
        Console.WriteLine(cells[1] + " " + cells[2]);
        string text = "a" + Trace(10) + await Slow(11) + Trace(12);
        Console.WriteLine(text);
        bool both = Trace(13) > 0 && await Slow(14) > 0;
        int chosen = both ? await Slow(15) : Trace(16);
        string label = null;
        label = label ?? "n" + await Slow(17);
        Console.WriteLine(both + " " + chosen + " " + label);
    }

    static async Task<string> Describe(string name)
    {
        try
        {
            await Task.Delay(1);
            if (name == "bad") throw new ArgumentException("bad name");
            return "ok " + name;
        }
        finally
        {
            await Task.Yield();
            Console.WriteLine("described " + name);
        }
    }

    static async Task<int> Retry()
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
            catch (ArgumentException e)
            {
                await Task.Delay(1);
                Console.WriteLine("retry after " + e.Message);
            }
        }
    }

    static async Task Rethrows()
    {
        try
        {
            await Throws(true);
        }
        catch (InvalidOperationException e) when (e.Message == "late")
        {
            await Task.Yield();
            Console.WriteLine("rethrowing " + e.Message);
            throw;
        }
    }

    static async Task<int> Loops(int count)
    {
        int total = 0;
        for (int i = 0; i < count; i++)
        {
            try
            {
                if (i == 1) continue;
                if (i == 4) break;
                total += await Slow(i * 10);
            }
            finally
            {
                await Task.Yield();
                Console.WriteLine("round " + i);
            }
        }
        return total;
    }

    static async Task<int> Resources(int[] values)
    {
        int sum = 0;
        using (Resource resource = new Resource("r"))
        {
            foreach (int value in values)
            {
                sum += await Slow(value);
                if (sum > 4) break;
            }
            try
            {
                await Task.Yield();
                sum += 1000;
            }
            finally
            {
                Console.WriteLine("plain finally");
            }
        }
        return sum;
    }

    static async void Fire(string text)
    {
        Console.WriteLine("fire " + text);
        await Task.Delay(1);
        Console.WriteLine("fired " + text);
    }

    static async Task Main()
    {
        await Order();

        Account account = new Account();
        Task<int> pending = account.Deposit(5);
        Console.WriteLine("after call " + account.Balance);
        Console.WriteLine(await pending + await account.Deposit(20));
        Console.WriteLine(await account.Fee(5));
        await account.Reset();
        Console.WriteLine("reset " + account.Balance);

        Meter meter = new Meter { Reading = 40 };
        Task<int> reading = meter.ReadLater(2);
        meter.Reading = 0;
        Console.WriteLine(await reading);

        Signal signal = new Signal { Value = 1 };
        Console.WriteLine(await signal);
        Console.WriteLine(await signal);

        Console.WriteLine(await Describe("x"));
        try { await Describe("bad"); }
        catch (ArgumentException e) { Console.WriteLine("caught " + e.Message); }
        Console.WriteLine(await Retry());
        try { await Rethrows(); }
        catch (InvalidOperationException e) { Console.WriteLine("outer " + e.Message); }
        Console.WriteLine(await Loops(6));
        Console.WriteLine(await Resources(new[] { 2, 3, 4 }));

        Task<int> early = Throws(false);
        Console.WriteLine("early is faulted: " + early.IsFaulted);
        try { await early; } catch (InvalidOperationException e) { Console.WriteLine(e.Message); }

        int captured = 5;
        Func<int, Task<int>> square = async v => { await Task.Delay(1); return v * v + captured; };
        Func<Task<int>> shortForm = async () => await square(3) + 1;
        Console.WriteLine(await square(7) + " " + await shortForm());
        async Task<int> Local(int k) { await Task.Yield(); captured += k; return captured; }
        Console.WriteLine(await Local(10) + await Local(1));

        Fire("x");
        Console.WriteLine("between");
        await Task.Delay(200);
        Console.WriteLine("done");
    }
}
