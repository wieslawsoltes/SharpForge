using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

public abstract record Message(int Id);
public sealed record OrderPlaced(int Id, string Sku, int Quantity) : Message(Id);
public sealed record OrderCancelled(int Id, string Reason) : Message(Id);
public sealed record Heartbeat(int Id) : Message(Id);

public sealed class MessageBus
{
    private readonly Channel<Message> inbox = Channel.CreateUnbounded<Message>(new UnboundedChannelOptions { SingleReader = true });
    private readonly Dictionary<Type, List<ChannelWriter<Message>>> routes = new Dictionary<Type, List<ChannelWriter<Message>>>();
    private readonly List<ChannelWriter<Message>> writers = new List<ChannelWriter<Message>>();
    public List<Message> DeadLetters { get; } = new List<Message>();

    public ChannelReader<Message> Subscribe(int capacity, params Type[] types)
    {
        Channel<Message> channel = Channel.CreateBounded<Message>(capacity);
        writers.Add(channel.Writer);
        foreach (Type type in types)
        {
            if (!routes.TryGetValue(type, out var targets)) routes[type] = targets = new List<ChannelWriter<Message>>();
            targets.Add(channel.Writer);
        }
        return channel.Reader;
    }

    public bool Publish(Message message) => inbox.Writer.TryWrite(message);
    public void Stop() => inbox.Writer.Complete();

    public async Task<int> DispatchAsync()
    {
        int routed = 0;
        await foreach (Message message in inbox.Reader.ReadAllAsync())
        {
            if (!routes.TryGetValue(message.GetType(), out var targets)) { DeadLetters.Add(message); continue; }
            foreach (ChannelWriter<Message> target in targets)
            {
                await target.WriteAsync(message);
                routed++;
            }
        }
        foreach (ChannelWriter<Message> writer in writers) writer.Complete();
        return routed;
    }
}

public static class Program
{
    private static async Task<List<TOut>> ConsumeAsync<TOut>(ChannelReader<Message> reader, Func<Message, TOut> handle)
    {
        var results = new List<TOut>();
        await foreach (Message message in reader.ReadAllAsync())
        {
            results.Add(handle(message));
            await Task.Yield();
        }
        return results;
    }

    private static async Task<int> ProduceAsync(ChannelWriter<int> writer, int count)
    {
        int written = 0;
        for (int i = 1; i <= count; i++) { await writer.WriteAsync(i * i); written++; }
        writer.Complete();
        return written;
    }

    private static string Fill(BoundedChannelFullMode mode)
    {
        var dropped = new List<int>();
        Channel<int> channel = Channel.CreateBounded<int>(new BoundedChannelOptions(2) { FullMode = mode }, dropped.Add);
        var accepted = new List<bool>();
        for (int i = 1; i <= 5; i++) accepted.Add(channel.Writer.TryWrite(i));
        var kept = new List<int>();
        while (channel.Reader.TryRead(out int item)) kept.Add(item);
        return mode + ": accepted=" + accepted.Count(a => a) + " kept=" + string.Join(",", kept) + " dropped=" + string.Join(",", dropped);
    }

    public static async Task Main(string[] args)
    {
        Channel<string> unbounded = Channel.CreateUnbounded<string>();
        foreach (string word in new[] { "alpha", "beta", "gamma" }) unbounded.Writer.TryWrite(word);
        Console.WriteLine("count=" + unbounded.Reader.Count + " peek=" + (unbounded.Reader.TryPeek(out string head) ? head : "-") + " completed=" + unbounded.Reader.Completion.IsCompleted);
        unbounded.Writer.Complete();
        var words = new List<string>();
        await foreach (string word in unbounded.Reader.ReadAllAsync()) words.Add(word);
        Console.WriteLine(string.Join(">", words) + " completed=" + unbounded.Reader.Completion.IsCompleted + " writeAfterComplete=" + unbounded.Writer.TryWrite("late") + " completeAgain=" + unbounded.Writer.TryComplete());

        foreach (BoundedChannelFullMode mode in new[] { BoundedChannelFullMode.Wait, BoundedChannelFullMode.DropWrite, BoundedChannelFullMode.DropOldest, BoundedChannelFullMode.DropNewest })
            Console.WriteLine(Fill(mode));

        Channel<int> narrow = Channel.CreateBounded<int>(1);
        Task<int> producer = ProduceAsync(narrow.Writer, 6);
        var squares = new List<int>();
        while (await narrow.Reader.WaitToReadAsync())
            while (narrow.Reader.TryRead(out int square)) squares.Add(square);
        Console.WriteLine("backpressure: wrote " + await producer + " read " + string.Join(",", squares) + " waitToRead=" + await narrow.Reader.WaitToReadAsync());

        Channel<int> crashing = Channel.CreateUnbounded<int>();
        crashing.Writer.TryWrite(1);
        crashing.Writer.TryWrite(2);
        crashing.Writer.Complete(new InvalidOperationException("producer crashed"));
        int drained = 0;
        try { await foreach (int item in crashing.Reader.ReadAllAsync()) drained += item; }
        catch (InvalidOperationException e) { Console.WriteLine("drained " + drained + " then: " + e.Message + " completion=" + crashing.Reader.Completion.Status); }
        try { await unbounded.Writer.WriteAsync("x"); }
        catch (ChannelClosedException e) { Console.WriteLine("write to closed: " + e.GetType().Name + " inner=" + (e.InnerException == null ? "none" : e.InnerException.GetType().Name)); }
        try { await unbounded.Reader.ReadAsync(); }
        catch (ChannelClosedException) { Console.WriteLine("read from closed and empty: ChannelClosedException"); }

        using var gate = new SemaphoreSlim(2, 2);
        var counts = new List<string>();
        await gate.WaitAsync();
        counts.Add("a" + gate.CurrentCount);
        await gate.WaitAsync();
        counts.Add("b" + gate.CurrentCount);
        counts.Add("timeout0=" + await gate.WaitAsync(0));
        counts.Add("released-from=" + gate.Release());
        counts.Add("again=" + await gate.WaitAsync(0));
        counts.Add("released-from=" + gate.Release(2));
        try { gate.Release(); }
        catch (SemaphoreFullException) { counts.Add("full"); }
        Console.WriteLine("semaphore: " + string.Join(" ", counts) + " final=" + gate.CurrentCount);

        var bus = new MessageBus();
        ChannelReader<Message> orders = bus.Subscribe(1, typeof(OrderPlaced), typeof(OrderCancelled));
        ChannelReader<Message> audit = bus.Subscribe(8, typeof(OrderPlaced), typeof(OrderCancelled), typeof(Heartbeat));
        ChannelReader<Message> cancellations = bus.Subscribe(2, typeof(OrderCancelled));
        Message[] traffic =
        {
            new OrderPlaced(1, "bolt", 40), new Heartbeat(2), new OrderPlaced(3, "gear", 2), new OrderCancelled(4, "duplicate"),
            new OrderPlaced(5, "bolt", 5), new OrderCancelled(6, "fraud"), new Heartbeat(7), new OrderPlaced(8, "gear", 1),
        };
        Console.WriteLine("published " + traffic.Count(bus.Publish) + " of " + traffic.Length);
        bus.Stop();
        Console.WriteLine("publish after stop: " + bus.Publish(new Heartbeat(99)));

        var stock = new SortedDictionary<string, int>(StringComparer.Ordinal);
        Task<int> dispatcher = bus.DispatchAsync();
        Task<List<string>> orderWorker = ConsumeAsync(orders, message =>
        {
            switch (message)
            {
                case OrderPlaced { Quantity: > 10 } bulk: stock[bulk.Sku] = stock.GetValueOrDefault(bulk.Sku) + bulk.Quantity; return "bulk#" + bulk.Id;
                case OrderPlaced placed: stock[placed.Sku] = stock.GetValueOrDefault(placed.Sku) + placed.Quantity; return "placed#" + placed.Id;
                case OrderCancelled cancelled: return "cancelled#" + cancelled.Id;
                default: return "unexpected#" + message.Id;
            }
        });
        Task<List<int>> auditWorker = ConsumeAsync(audit, message => message.Id);
        Task<List<string>> cancelWorker = ConsumeAsync(cancellations, message => ((OrderCancelled)message).Reason);
        await Task.WhenAll(dispatcher, orderWorker, auditWorker, cancelWorker);

        Console.WriteLine("routed=" + dispatcher.Result + " dead=" + bus.DeadLetters.Count);
        Console.WriteLine("orders: " + string.Join(" ", await orderWorker));
        Console.WriteLine("audit ids: " + string.Join(",", await auditWorker) + " sum=" + auditWorker.Result.Sum());
        Console.WriteLine("cancel reasons: " + string.Join("+", await cancelWorker));
        Console.WriteLine("stock: " + string.Join(", ", stock.Select(pair => pair.Key + "=" + pair.Value)));
        Console.WriteLine("subscriber channels closed: " + (orders.Completion.IsCompletedSuccessfully && audit.Completion.IsCompletedSuccessfully && cancellations.Completion.IsCompletedSuccessfully) + " args=" + args.Length);
    }
}
