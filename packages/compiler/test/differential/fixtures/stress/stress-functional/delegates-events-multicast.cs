using System;
using System.Collections.Generic;
using System.Linq;

public delegate int Transform(int value);
public delegate void Notify<in T>(string source, T payload);
public delegate bool TryParse<T>(string text, out T value);
public delegate ref int Selector(int[] items);

public sealed class Publisher
{
    private readonly List<string> log;
    public Publisher(List<string> log) { this.log = log; }
    public event Notify<string> Message;
    public event EventHandler Closed;
    public static event Action<int> Global;

    public void Send(string text) => Message?.Invoke(nameof(Publisher), text);
    public void Close() { Closed?.Invoke(this, EventArgs.Empty); Closed = null; }
    public static void RaiseGlobal(int value) => Global?.Invoke(value);
    public int Subscribers => Message?.GetInvocationList().Length ?? 0;
    public void Record(string source, string payload) => log.Add(source + ":" + payload);
}

public sealed class Subscriber
{
    private readonly string name;
    private readonly List<string> log;
    public Subscriber(string name, List<string> log) { this.name = name; this.log = log; }
    public void OnMessage(string source, object payload) => log.Add(name + " got " + payload);
    public void OnClosed(object sender, EventArgs e) => log.Add(name + " closed " + (sender is Publisher));
    public static void OnGlobal(int value) => Console.Write("global " + value + "; ");
}

public static class MathOps
{
    public static int Double(int x) => x * 2;
    public static int Negate(int x) => -x;
    public static int AddLength(this string text, int x) => x + text.Length;
    public static T Identity<T>(T x) => x;
}

public static class Program
{
    private static int Run(Transform transform, int seed) => transform(seed);

    public static void Main()
    {
        var log = new List<string>();
        var publisher = new Publisher(log);
        var alice = new Subscriber("alice", log);
        var bob = new Subscriber("bob", log);
        Notify<string> aliceHandler = alice.OnMessage;
        publisher.Message += aliceHandler;
        publisher.Message += bob.OnMessage;
        publisher.Message += publisher.Record;
        publisher.Message += (source, text) => log.Add("lambda " + text.Length);
        publisher.Send("hello");
        publisher.Message -= alice.OnMessage;
        publisher.Message -= bob.OnMessage;
        publisher.Message -= (source, text) => log.Add("never removed");
        publisher.Send("again");
        Console.WriteLine(string.Join(" | ", log) + " subscribers=" + publisher.Subscribers);
        log.Clear();
        publisher.Closed += alice.OnClosed;
        publisher.Closed += bob.OnClosed;
        publisher.Close();
        publisher.Close();
        Publisher.Global += Subscriber.OnGlobal;
        Publisher.Global += Subscriber.OnGlobal;
        Publisher.RaiseGlobal(5);
        Publisher.Global -= Subscriber.OnGlobal;
        Publisher.RaiseGlobal(6);
        Console.WriteLine(string.Join(" | ", log));

        Transform doubler = MathOps.Double, negate = MathOps.Negate;
        Transform both = doubler + negate;
        Transform addTen = "tenletters".AddLength;
        Transform closure = new Transform(x => x * x);
        Transform chained = (Transform)Delegate.Combine(both, closure, doubler);
        Console.WriteLine(Run(doubler, 4) + " " + both(4) + " " + addTen(0) + " " + Run(MathOps.Identity, 9) + " " + chained(3) + " " + chained.GetInvocationList().Length + " " + string.Join(",", chained.GetInvocationList().Select(d => ((Transform)d)(3))));
        Transform removed = chained - doubler;
        Transform nothing = doubler - doubler;
        Console.WriteLine(removed.GetInvocationList().Length + " " + (nothing == null) + " " + (doubler == MathOps.Double) + " " + (both == doubler + negate) + " " + (closure == new Transform(x => x * x)) + " " + doubler.Method.Name + " " + (doubler.Target == null) + " " + (aliceHandler.Target == alice));

        Func<int, int> func = MathOps.Double;
        Transform converted = new Transform(func);
        Func<int, int> composed = x => converted(func(x));
        Action<string> print = Console.Write;
        Action<string> twice = print + print;
        twice("ab");
        Func<string, string, bool> equals = string.Equals;
        Func<string> bound = "bound".ToUpperInvariant;
        Func<object, string> toText = Convert.ToString;
        Func<int, string> intToText = "abcdef".Substring;
        Console.WriteLine(" " + composed(3) + " " + equals("a", "a") + " " + bound() + " " + toText(1.5) + " " + intToText(4) + " " + new Func<int, int, int>(Math.Max)(3, 7));

        TryParse<int> parseInt = int.TryParse;
        TryParse<double> parseDouble = (string text, out double value) => double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value);
        Console.WriteLine(parseInt("12", out int i) + " " + i + " " + parseDouble("1.5e1", out double d) + " " + d + " " + parseInt("x", out _));
        Selector lastItem = items => ref items[items.Length - 1];
        int[] data = { 1, 2, 3 };
        lastItem(data) = 30;
        lastItem(data)++;
        Console.WriteLine(string.Join(",", data));

        var handlers = new Dictionary<string, Action<List<string>>>();
        foreach (var name in new[] { "x", "y", "z" }) handlers[name] = target => target.Add(name.ToUpperInvariant());
        Action<List<string>> all = null;
        foreach (var handler in handlers.Values) all += handler;
        all -= handlers["y"];
        var output = new List<string>();
        all?.Invoke(output);
        all.DynamicInvoke(output);
        Console.WriteLine(string.Join("", output));
        Func<int> faulty = () => throw new InvalidOperationException("first");
        faulty += () => 2;
        try { faulty(); } catch (InvalidOperationException e) { Console.WriteLine("stopped at " + e.Message); }
        Func<int> counted = () => 1;
        counted += () => 2;
        counted += () => 3;
        Console.WriteLine(counted() + " " + counted.GetInvocationList().Sum(f => ((Func<int>)f)()));
    }
}
