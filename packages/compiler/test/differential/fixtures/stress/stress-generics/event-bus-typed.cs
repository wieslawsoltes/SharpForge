using System;
using System.Collections.Generic;
using System.Linq;

public interface IMessage { int Sequence { get; set; } }
public abstract class Message : IMessage
{
    public int Sequence { get; set; }
    public override string ToString() => GetType().Name + "#" + Sequence;
}
public class UserCreated : Message { public string Name; }
public sealed class AdminCreated : UserCreated { public int Level; }
public sealed class OrderPlaced : Message { public decimal Total; public string User; }
public struct Tick : IMessage { public int Sequence { get; set; } public long Time; }

public interface IHandler<in TMessage> where TMessage : IMessage
{
    void Handle(TMessage message);
}

public sealed class EventBus
{
    private readonly Dictionary<Type, List<Delegate>> handlers = new Dictionary<Type, List<Delegate>>();
    private readonly List<(Type Type, Func<IMessage, bool> Predicate, Action<IMessage> Action)> filters = new List<(Type, Func<IMessage, bool>, Action<IMessage>)>();
    private int sequence;
    public int Delivered { get; private set; }

    public IDisposable Subscribe<TMessage>(Action<TMessage> handler) where TMessage : IMessage
    {
        if (!handlers.TryGetValue(typeof(TMessage), out var list)) handlers[typeof(TMessage)] = list = new List<Delegate>();
        list.Add(handler);
        return new Unsubscriber(() => list.Remove(handler));
    }

    public IDisposable Subscribe<TMessage>(IHandler<TMessage> handler) where TMessage : IMessage => Subscribe<TMessage>(handler.Handle);

    public void SubscribeWhere<TMessage>(Func<TMessage, bool> predicate, Action<TMessage> action) where TMessage : IMessage
        => filters.Add((typeof(TMessage), message => predicate((TMessage)message), message => action((TMessage)message)));

    public int Publish<TMessage>(TMessage message) where TMessage : IMessage
    {
        message.Sequence = ++sequence;
        int count = 0;
        for (Type type = message.GetType(); type != null; type = type.BaseType)
        {
            if (!handlers.TryGetValue(type, out var list)) continue;
            foreach (var handler in list.ToArray())
            {
                if (handler is Action<TMessage> exact) exact(message);
                else handler.DynamicInvoke(message);
                count++;
            }
        }
        foreach (var (type, predicate, action) in filters)
        {
            if (!type.IsInstanceOfType(message) || !predicate(message)) continue;
            action(message);
            count++;
        }
        Delivered += count;
        return count;
    }

    private sealed class Unsubscriber : IDisposable
    {
        private Action dispose;
        public Unsubscriber(Action dispose) { this.dispose = dispose; }
        public void Dispose() { dispose?.Invoke(); dispose = null; }
    }
}

public sealed class Audit : IHandler<Message>, IHandler<Tick>
{
    public readonly List<string> Entries = new List<string>();
    public void Handle(Message message) => Entries.Add("audit " + message);
    public void Handle(Tick tick) => Entries.Add("tick " + tick.Time);
}

public sealed class Projection<TKey, TState> where TState : new()
{
    private readonly Dictionary<TKey, TState> states = new Dictionary<TKey, TState>();
    public void Apply(TKey key, Func<TState, TState> update) => states[key] = update(states.TryGetValue(key, out var state) ? state : new TState());
    public IEnumerable<KeyValuePair<TKey, TState>> Snapshot => states.OrderBy(pair => pair.Key);
}

public static class Program
{
    public static void Main()
    {
        var bus = new EventBus();
        var log = new List<string>();
        var audit = new Audit();
        var totals = new Projection<string, (int Orders, decimal Spent)>();
        var users = bus.Subscribe<UserCreated>(e => log.Add("user " + e.Name));
        bus.Subscribe<AdminCreated>(e => log.Add("admin " + e.Name + " L" + e.Level));
        bus.Subscribe<OrderPlaced>(e => totals.Apply(e.User, state => (state.Orders + 1, state.Spent + e.Total)));
        bus.Subscribe<Message>(audit);
        var ticks = bus.Subscribe<Tick>(audit);
        bus.SubscribeWhere<OrderPlaced>(e => e.Total >= 100, e => log.Add("big order " + e.Total + " by " + e.User));
        bus.SubscribeWhere<IMessage>(m => m.Sequence % 4 == 0, m => log.Add("every fourth: " + m.GetType().Name));

        var counts = new List<int>
        {
            bus.Publish(new UserCreated { Name = "ada" }),
            bus.Publish(new AdminCreated { Name = "root", Level = 9 }),
            bus.Publish<UserCreated>(new AdminCreated { Name = "sub", Level = 1 }),
            bus.Publish(new OrderPlaced { User = "ada", Total = 30 }),
            bus.Publish(new Tick { Time = 1000 }),
            bus.Publish(new OrderPlaced { User = "ada", Total = 120.5m }),
        };
        users.Dispose();
        users.Dispose();
        ticks.Dispose();
        counts.Add(bus.Publish(new UserCreated { Name = "late" }));
        counts.Add(bus.Publish(new Tick { Time = 2000 }));
        counts.Add(bus.Publish<IMessage>(new OrderPlaced { User = "bob", Total = 5 }));
        Console.WriteLine(string.Join(",", counts) + " delivered " + bus.Delivered);
        Console.WriteLine(string.Join(" | ", log));
        Console.WriteLine(string.Join(" | ", audit.Entries));
        Console.WriteLine(string.Join(" ", totals.Snapshot.Select(pair => $"{pair.Key}:{pair.Value.Orders}:{pair.Value.Spent}")));

        IHandler<Message> general = audit;
        IHandler<AdminCreated> specific = general;
        specific.Handle(new AdminCreated { Sequence = 99 });
        var counters = new Projection<Type, List<int>>();
        foreach (var entry in audit.Entries.Select((text, index) => (text, index))) counters.Apply(entry.text.StartsWith("tick") ? typeof(Tick) : typeof(Message), list => { list.Add(entry.index); return list; });
        Console.WriteLine(audit.Entries.Last() + " " + string.Join(" ", counters.Snapshot.OrderBy(p => p.Key.Name).Select(p => p.Key.Name + "=" + string.Join("", p.Value))));
    }
}
