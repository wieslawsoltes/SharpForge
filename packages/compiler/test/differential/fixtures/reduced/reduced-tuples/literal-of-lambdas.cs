using System;
using System.Collections.Generic;
public interface IMessage { int Sequence { get; set; } }
public class UserCreated : IMessage { public int Sequence { get; set; } public string Name; }
public struct Tick : IMessage { public int Sequence { get; set; } }
public static class Program
{
    static readonly List<(Type Type, Func<IMessage, bool> Predicate, Action<IMessage> Action)> filters = new List<(Type, Func<IMessage, bool>, Action<IMessage>)>();
    static int Publish<TMessage>(TMessage message) where TMessage : IMessage
    {
        int count = 0;
        foreach (var (type, predicate, action) in filters)
        {
            if (!type.IsInstanceOfType(message) || !predicate(message)) continue;
            action(message);
            count++;
        }
        IMessage boxed = message;
        object o = message;
        Func<IMessage, int> read = m => m.Sequence;
        return count * 100 + read(message) + boxed.Sequence + (o is IMessage ? 1000 : 0);
    }
    public static void Main()
    {
        var log = new List<string>();
        filters.Add((typeof(IMessage), m => m.Sequence % 2 == 0, m => log.Add("even " + m.GetType().Name)));
        filters.Add((typeof(Tick), m => true, m => log.Add("tick " + m.Sequence)));
        Console.WriteLine(Publish(new UserCreated { Sequence = 2 }) + " " + Publish(new Tick { Sequence = 3 }) + " " + Publish<IMessage>(new Tick { Sequence = 4 }) + " " + string.Join(",", log));
    }
}
