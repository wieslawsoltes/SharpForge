using System;
using System.Collections.Generic;

// Reduced from stress-interfaces/generic-events-ticker: an event implemented explicitly (`event D I.Closed { add ...
// remove ... }`) next to a public event of the same name, for a plain and for a generic interface.
public interface IFeed
{
    event Action<string> Closed;
}

public interface IChannel<T>
{
    event Action<T> Received;
}

public sealed class Ticker : IFeed, IChannel<int>, IChannel<string>
{
    private Action<string> interfaceClosed;
    private readonly List<string> log = new List<string>();

    public event Action<string> Closed;

    event Action<string> IFeed.Closed
    {
        add { log.Add("add"); interfaceClosed += value; }
        remove { log.Add("remove"); interfaceClosed -= value; }
    }

    private Action<int> numbers;
    event Action<int> IChannel<int>.Received { add => numbers += value; remove => numbers -= value; }

    public event Action<string> Received;

    public string Close(string reason)
    {
        Closed?.Invoke("public:" + reason);
        interfaceClosed?.Invoke("interface:" + reason);
        numbers?.Invoke(reason.Length);
        Received?.Invoke("text:" + reason);
        return string.Join(",", log);
    }
}

public static class Program
{
    public static void Main()
    {
        var seen = new List<string>();
        var ticker = new Ticker();
        IFeed feed = ticker;
        Action<string> viaInterface = reason => seen.Add("i " + reason);
        ticker.Closed += reason => seen.Add("p " + reason);
        feed.Closed += viaInterface;
        ((IChannel<int>)ticker).Received += length => seen.Add("n " + length);
        ((IChannel<string>)ticker).Received += text => seen.Add("s " + text);
        Console.WriteLine(ticker.Close("eod") + " | " + string.Join("; ", seen));
        seen.Clear();
        feed.Closed -= viaInterface;
        Console.WriteLine(ticker.Close("x") + " | " + string.Join("; ", seen));
    }
}
