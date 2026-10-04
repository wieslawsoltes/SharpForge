using System;
using System.Collections.Generic;
using System.Linq;

public sealed class PriceChangedEventArgs : EventArgs
{
    public PriceChangedEventArgs(string symbol, int oldPrice, int newPrice) { Symbol = symbol; OldPrice = oldPrice; NewPrice = newPrice; }
    public string Symbol { get; }
    public int OldPrice { get; }
    public int NewPrice { get; }
    public bool Cancel { get; set; }
}

public class TradeEventArgs<TPayload> : EventArgs
{
    public TradeEventArgs(TPayload payload) { Payload = payload; }
    public TPayload Payload { get; }
}

public delegate bool Validator<in T>(T item, out string error);
public delegate TResult Reducer<TState, in TItem, out TResult>(ref TState state, TItem item);

public interface IFeed
{
    event EventHandler<PriceChangedEventArgs> PriceChanged;
    event Action<string> Closed;
}

public class Ticker : IFeed
{
    private readonly SortedDictionary<string, int> prices = new SortedDictionary<string, int>();
    private EventHandler<PriceChangedEventArgs> priceChanged;
    private Action<string> interfaceClosed;
    public int Added { get; private set; }
    public int Removed { get; private set; }

    public event EventHandler<PriceChangedEventArgs> PriceChanged
    {
        add { priceChanged += value; Added++; }
        remove
        {
            var before = priceChanged;
            priceChanged -= value;
            if (!Equals(before, priceChanged)) Removed++;
        }
    }
    public event Action<string> Closed;
    event Action<string> IFeed.Closed { add => interfaceClosed += value; remove => interfaceClosed -= value; }
    public event Func<string, int, bool> Approving;
    public static event EventHandler<TradeEventArgs<(string Symbol, int Price)>> AnyTrade;

    public int Handlers => priceChanged?.GetInvocationList().Length ?? 0;
    public string Snapshot => string.Join(",", prices.Select(p => p.Key + "=" + p.Value));
    protected virtual void OnPriceChanged(PriceChangedEventArgs e) => priceChanged?.Invoke(this, e);

    public string Set(string symbol, int price)
    {
        if (Approving != null)
            foreach (Func<string, int, bool> approver in Approving.GetInvocationList())
                if (!approver(symbol, price)) return "vetoed";
        prices.TryGetValue(symbol, out int old);
        var args = new PriceChangedEventArgs(symbol, old, price);
        OnPriceChanged(args);
        if (args.Cancel) return "cancelled";
        prices[symbol] = price;
        AnyTrade?.Invoke(this, new TradeEventArgs<(string, int)>((symbol, price)));
        return "ok";
    }
    public bool LastApproval(string symbol, int price) => Approving?.Invoke(symbol, price) ?? true;
    public void Close(string reason) { Closed?.Invoke("public:" + reason); interfaceClosed?.Invoke("interface:" + reason); }
}

public sealed class AuditedTicker : Ticker
{
    public readonly List<string> Audit = new List<string>();
    protected override void OnPriceChanged(PriceChangedEventArgs e)
    {
        Audit.Add(e.Symbol + ":" + e.OldPrice + ">" + e.NewPrice);
        base.OnPriceChanged(e);
        if (e.Cancel) Audit.Add("cancelled");
    }
}

public sealed class Channel<T>
{
    public event Action<Channel<T>, T> Message;
    public int Publish(params T[] items)
    {
        foreach (T item in items) Message?.Invoke(this, item);
        return Message?.GetInvocationList().Length ?? 0;
    }
}

public sealed class Portfolio
{
    private readonly string owner;
    public readonly List<string> Seen = new List<string>();
    public Portfolio(string owner) { this.owner = owner; }
    public void OnPrice(object sender, PriceChangedEventArgs e) => Seen.Add(owner + ":" + e.Symbol + (e.NewPrice - e.OldPrice).ToString("+0;-0"));
    public bool Approve(string symbol, int price) { Seen.Add(owner + "?" + symbol); return price < 1000; }
}

public static class Program
{
    private static readonly List<string> Log = new List<string>();
    private static void LogAny(object sender, EventArgs e) => Log.Add("any:" + sender.GetType().Name + "/" + e.GetType().Name);
    private static void Flush(string title) { Console.WriteLine(title + ": " + string.Join(" ", Log)); Log.Clear(); }
    private static string Names(Delegate d) => d == null ? "<null>" : string.Join("+", d.GetInvocationList().Select(x => x.Method.Name));
    private static void A() => Log.Add("A");
    private static void B() => Log.Add("B");
    private static void C() => Log.Add("C");

    public static void Main()
    {
        var ticker = new AuditedTicker();
        var alice = new Portfolio("alice");
        var bob = new Portfolio("bob");
        EventHandler<PriceChangedEventArgs> guard = (sender, e) => { if (e.NewPrice < 0) e.Cancel = true; Log.Add("guard(" + e.NewPrice + ")"); };
        ticker.PriceChanged += alice.OnPrice;
        ticker.PriceChanged += guard;
        ticker.PriceChanged += bob.OnPrice;
        ticker.PriceChanged += alice.OnPrice;
        ticker.PriceChanged += LogAny;
        EventHandler<TradeEventArgs<(string Symbol, int Price)>> tradeLog = (_, e) => Log.Add("trade:" + e.Payload.Symbol + "@" + e.Payload.Price);
        Ticker.AnyTrade += tradeLog;
        Console.WriteLine("set: " + ticker.Set("ACME", 120) + " " + ticker.Set("ACME", 95) + " " + ticker.Set("BOLT", -5) + " handlers=" + ticker.Handlers + " added=" + ticker.Added + " | " + ticker.Snapshot);
        Flush("log");
        Console.WriteLine("alice: " + string.Join(" ", alice.Seen) + " | bob: " + string.Join(" ", bob.Seen) + " | audit: " + string.Join(" ", ticker.Audit));

        ticker.PriceChanged -= alice.OnPrice;                       // removes the last matching subscription only
        ticker.PriceChanged -= new Portfolio("carol").OnPrice;      // never subscribed: no effect
        ticker.PriceChanged -= (sender, e) => Log.Add("never");     // a new lambda instance: no effect
        ticker.PriceChanged -= guard;
        Ticker.AnyTrade -= tradeLog;
        alice.Seen.Clear(); bob.Seen.Clear();
        Console.WriteLine("after remove: " + ticker.Set("BOLT", -5) + " handlers=" + ticker.Handlers + " removed=" + ticker.Removed + " order=" + string.Join(",", alice.Seen.Concat(bob.Seen)) + " | " + ticker.Snapshot);
        Flush("log");

        ticker.Approving += alice.Approve;
        ticker.Approving += (symbol, price) => { Log.Add("even?" + price); return price % 2 == 0; };
        ticker.Approving += bob.Approve;
        Console.WriteLine("approvals: " + ticker.Set("CORE", 2000) + " " + ticker.Set("CORE", 7) + " " + ticker.Set("CORE", 8) + " last-wins=" + ticker.LastApproval("X", 3) + "/" + ticker.LastApproval("X", 4000)
            + " asked=" + alice.Seen.Count(s => s.Contains('?')) + "/" + bob.Seen.Count(s => s.Contains('?')));
        Flush("log");

        IFeed feed = ticker;
        ticker.Closed += reason => Log.Add("1:" + reason);
        feed.Closed += reason => Log.Add("2:" + reason);
        feed.PriceChanged += (s, e) => Log.Add("via-interface:" + e.Symbol);
        ticker.Set("DYNE", 2);
        ticker.Close("eod");
        Flush("close");

        // Delegate arithmetic: combination order, removal of sub-lists, equality and null results.
        Action a = A, b = B, c = C;
        Action abc = a + b + c, abca = (Action)Delegate.Combine(abc, a);
        Console.WriteLine("combine: " + Names(abc) + " | " + Names(abca) + " | -A " + Names(abca - a) + " | -(B+C) " + Names(abc - (b + c)) + " | -(A+C) " + Names(abc - (a + c)) + " | -all " + Names(abc - abc)
            + " | removeAll " + Names(Delegate.RemoveAll(abca, a)) + " | remove missing " + Names(Delegate.Remove(a, b)) + " | null+B " + Names((Action)null + b));
        Console.WriteLine("equality: " + (a == new Action(A)) + " " + (abc == a + b + c) + " " + (abc == a + c + b) + " " + (new Action(alice.Seen.Clear) == new Action(alice.Seen.Clear)) + " " + (new Action(alice.Seen.Clear) == new Action(bob.Seen.Clear))
            + " " + (a.Target == null) + " " + ReferenceEquals(new Action(alice.Seen.Clear).Target, alice.Seen) + " " + abc.GetInvocationList().Length + " " + ((Action)(() => { }) == (Action)(() => { })));

        Func<int, int> twice = x => { Log.Add("twice"); return x * 2; }, square = x => { Log.Add("square"); return x * x; }, negate = x => { Log.Add("negate"); return -x; };
        Func<int, int> chain = twice + square + negate;
        Console.WriteLine("multicast result: " + chain(7) + " all: " + string.Join(",", chain.GetInvocationList().Cast<Func<int, int>>().Select(f => f(7))) + " piped: " + chain.GetInvocationList().Cast<Func<int, int>>().Aggregate(3, (acc, f) => f(acc)));
        Flush("calls");

        Action risky = a;
        risky += () => throw new InvalidOperationException("boom");
        risky += c;
        try { risky(); } catch (InvalidOperationException e) { Log.Add("caught:" + e.Message); }
        foreach (Action step in risky.GetInvocationList()) { try { step(); } catch (InvalidOperationException) { Log.Add("skipped"); } }
        Flush("exceptions");

        var handlers = new List<Action>();
        for (int i = 0; i < 3; i++) handlers.Add(() => Log.Add("for" + i));
        foreach (int i in new[] { 0, 1, 2 }) handlers.Add(() => Log.Add("each" + i));
        handlers.Aggregate((x, y) => x + y)();
        Flush("captures");

        var numbers = new Channel<int>();
        var words = new Channel<string>();
        int sum = 0;
        Action<Channel<int>, int> once = null;
        once = (channel, value) => { Log.Add("once:" + value); channel.Message -= once; };
        numbers.Message += once;
        numbers.Message += (_, value) => sum += value;
        Action<object, object> anything = (sender, value) => Log.Add(sender.GetType().Name.Split('`')[0] + "<" + value + ">");
        words.Message += new Action<Channel<string>, string>(anything);
        int left = numbers.Publish(1, 2, 3);
        Console.WriteLine("channels: sum=" + sum + " left=" + left + " words=" + words.Publish("x", "y") + " empty=" + new Channel<bool>().Publish(true));
        Flush("channel log");

        Validator<object> notNull = (object item, out string error) => { error = item == null ? "null" : null; return item != null; };
        Validator<string> shortText = (string item, out string error) => { error = item.Length > 3 ? "too long:" + item.Length : null; return error == null; };
        Validator<string> viaVariance = notNull, both = new Validator<string>(notNull);
        both += shortText;
        var verdicts = new[] { "ok", "lengthy" }.Select(text => { bool valid = both(text, out string error); return text + "=" + valid + "/" + (error ?? "-"); });
        Reducer<int, object, string> tally = (ref int state, object item) => { state += item.ToString().Length; return item + ":" + state; };
        Reducer<int, string, object> narrowed = tally;
        int total = 0;
        Console.WriteLine("validators: " + string.Join(" ", verdicts) + " | reducer: " + narrowed(ref total, "ab") + " " + narrowed(ref total, "cde") + " total=" + total
            + " variance=" + viaVariance("v", out _) + "/" + ReferenceEquals(viaVariance, notNull) + "/" + (both.GetInvocationList()[0].Target == notNull.Target));
    }
}
