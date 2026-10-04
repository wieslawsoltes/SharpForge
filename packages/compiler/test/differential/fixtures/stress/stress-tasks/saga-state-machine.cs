using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

public enum SagaState { Created, FlightBooked, HotelBooked, CarBooked, Paid, Completed, Compensating, Failed }

public sealed class ServiceException : Exception
{
    public bool Transient { get; }
    public ServiceException(string operation, bool transient) : base(operation + (transient ? " timed out" : " rejected")) { Transient = transient; }
}

public sealed class FakeServices
{
    private readonly Dictionary<string, Queue<char>> script = new Dictionary<string, Queue<char>>();
    private int nextId = 100;
    public List<string> Journal { get; } = new List<string>();

    public FakeServices Plan(string operation, string outcomes) { script[operation] = new Queue<char>(outcomes); return this; }

    public async Task<string> CallAsync(string operation)
    {
        await Task.Yield();
        char outcome = script.TryGetValue(operation, out Queue<char> planned) && planned.Count > 0 ? planned.Dequeue() : 'S';
        Journal.Add(operation + (outcome == 'S' ? "" : outcome == 'T' ? "!timeout" : "!rejected"));
        return outcome switch
        {
            'S' => operation + "#" + nextId++,
            'T' => throw new ServiceException(operation, true),
            _ => throw new ServiceException(operation, false),
        };
    }
}

public sealed class AsyncLock
{
    private readonly SemaphoreSlim semaphore = new SemaphoreSlim(1, 1);
    public int Acquisitions { get; private set; }
    public bool IsHeld => semaphore.CurrentCount == 0;
    public async Task<Releaser> AcquireAsync() { await semaphore.WaitAsync(); Acquisitions++; return new Releaser(semaphore); }

    public readonly struct Releaser : IDisposable
    {
        private readonly SemaphoreSlim semaphore;
        public Releaser(SemaphoreSlim semaphore) { this.semaphore = semaphore; }
        public void Dispose() => semaphore.Release();
    }
}

public sealed class BookingSaga
{
    private readonly FakeServices services;
    private readonly AsyncLock gate;
    private readonly Stack<(string Name, Func<Task> Undo)> compensations = new Stack<(string, Func<Task>)>();
    private readonly Dictionary<SagaState, Func<Task<SagaState>>> transitions;
    public SagaState State { get; private set; }
    public List<string> Confirmations { get; } = new List<string>();
    public List<string> History { get; } = new List<string>();
    public int UndoFailures { get; private set; }

    public BookingSaga(FakeServices services, AsyncLock gate, bool withCar)
    {
        this.services = services;
        this.gate = gate;
        transitions = new Dictionary<SagaState, Func<Task<SagaState>>>
        {
            [SagaState.Created] = async () => await StepAsync("flight") ? SagaState.FlightBooked : SagaState.Compensating,
            [SagaState.FlightBooked] = async () => !await StepAsync("hotel") ? SagaState.Compensating : withCar ? SagaState.HotelBooked : SagaState.CarBooked,
            [SagaState.HotelBooked] = async () =>
            {
                if (!await StepAsync("car", maxAttempts: 1)) services.Journal.Add("(car is optional)");
                return SagaState.CarBooked;
            },
            [SagaState.CarBooked] = async () => await StepAsync("payment", maxAttempts: 3) ? SagaState.Paid : SagaState.Compensating,
            [SagaState.Paid] = () => Task.FromResult(SagaState.Completed),
            [SagaState.Compensating] = CompensateAsync,
        };
    }

    public async Task<SagaState> RunAsync()
    {
        using (await gate.AcquireAsync())
        {
            while (State is not (SagaState.Completed or SagaState.Failed))
            {
                SagaState before = State;
                State = await transitions[State]();
                History.Add(before + ">" + State);
            }
        }
        return State;
    }

    private async Task<bool> StepAsync(string name, int maxAttempts = 2)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                string confirmation = await services.CallAsync("book-" + name);
                Confirmations.Add(confirmation);
                compensations.Push((name, async () => { await services.CallAsync("cancel-" + name); Confirmations.Remove(confirmation); }));
                return true;
            }
            catch (ServiceException e) when (e.Transient && attempt < maxAttempts)
            {
                await services.CallAsync("backoff-" + attempt);
            }
            catch (ServiceException e)
            {
                services.Journal.Add("(gave up on " + name + " after " + attempt + ": " + e.Message + ")");
                return false;
            }
        }
    }

    private async Task<SagaState> CompensateAsync()
    {
        while (compensations.Count > 0)
        {
            var (name, undo) = compensations.Pop();
            try { await undo(); }
            catch (ServiceException) { UndoFailures++; services.Journal.Add("(manual cleanup for " + name + ")"); }
            finally { await services.CallAsync("audit-" + name); }
        }
        return SagaState.Failed;
    }
}

public static class Program
{
    private static async Task<string> SummarizeAsync(BookingSaga saga, FakeServices services)
    {
        async Task<int> CountAsync(int index) => index >= saga.Confirmations.Count ? 0 : 1 + await CountAsync(index + 1);

        int bookings = await CountAsync(0);
        string receipt = null;
        switch (saga.State)
        {
            case SagaState.Completed when bookings > 3:
                receipt = await services.CallAsync("receipt-premium");
                goto case SagaState.Completed;
            case SagaState.Completed:
                receipt ??= await services.CallAsync("receipt");
                break;
            case SagaState.Failed:
                break;
            default:
                throw new InvalidOperationException("saga still running in " + saga.State);
        }
        string verdict = saga.State switch
        {
            SagaState.Completed => "confirmed " + bookings + " via " + receipt,
            SagaState.Failed when saga.UndoFailures > 0 => "failed, " + saga.UndoFailures + " undo failure(s), ticket " + await services.CallAsync("ticket"),
            _ => "failed cleanly, " + bookings + " left",
        };
        return verdict + (saga.Confirmations.Count > 0 ? " [" + string.Join(",", saga.Confirmations) + "]" : "");
    }

    public static async Task Main()
    {
        var gate = new AsyncLock();
        var scenarios = new (string Name, bool WithCar, Action<FakeServices> Setup)[]
        {
            ("happy", true, s => { }),
            ("retry", false, s => s.Plan("book-flight", "TS").Plan("book-payment", "TTS")),
            ("no-car", true, s => s.Plan("book-car", "T")),
            ("declined", true, s => s.Plan("book-payment", "F")),
            ("stuck", false, s => s.Plan("book-payment", "TTT").Plan("cancel-hotel", "F")),
            ("no-flight", true, s => s.Plan("book-flight", "TF")),
        };
        int completed = 0;
        foreach (var (name, withCar, setup) in scenarios)
        {
            var services = new FakeServices();
            setup(services);
            var saga = new BookingSaga(services, gate, withCar);
            Task<SagaState> run = saga.RunAsync();
            SagaState final = await run;
            if (final == SagaState.Completed) completed++;
            Console.WriteLine(name + ": " + final + " in " + saga.History.Count + " transitions, lock held=" + gate.IsHeld);
            Console.WriteLine("  path: " + string.Join(" ", saga.History.Select(step => step.Substring(step.IndexOf('>') + 1))));
            Console.WriteLine("  calls: " + string.Join(" ", services.Journal));
            Console.WriteLine("  " + await SummarizeAsync(saga, services));
        }
        Console.WriteLine("completed " + completed + "/" + scenarios.Length + ", lock acquisitions " + gate.Acquisitions);

        var unfinished = new BookingSaga(new FakeServices(), gate, false);
        try { Console.WriteLine(await SummarizeAsync(unfinished, new FakeServices())); }
        catch (InvalidOperationException e) { Console.WriteLine("summary refused: " + e.Message); }
    }
}
