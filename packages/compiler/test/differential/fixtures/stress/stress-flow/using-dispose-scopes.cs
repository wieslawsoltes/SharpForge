using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

public sealed class Tracker
{
    public readonly List<string> Events = new List<string>();
    public IDisposable Scope(string name)
    {
        Events.Add("{" + name);
        return new Releaser(() => Events.Add(name + "}"));
    }
    public string Drain() { string text = string.Join(" ", Events); Events.Clear(); return text; }

    private sealed class Releaser : IDisposable
    {
        private readonly Action release;
        private int count;
        public Releaser(Action release) { this.release = release; }
        public void Dispose() { if (count++ == 0) release(); }
    }
}

public class Connection : IDisposable
{
    private static int opened;
    protected readonly Tracker tracker;
    private bool disposed;
    public Connection(Tracker tracker, bool fail = false)
    {
        this.tracker = tracker;
        Id = ++opened;
        if (fail) throw new IOException("connect failed " + Id);
        tracker.Events.Add("open" + Id);
    }
    public int Id { get; }
    public Transaction Begin() => disposed ? throw new ObjectDisposedException(nameof(Connection)) : new Transaction(this, tracker);
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }
    protected virtual void Dispose(bool disposing)
    {
        if (disposed) return;
        disposed = true;
        tracker.Events.Add("close" + Id);
    }
}

public sealed class PooledConnection : Connection
{
    public PooledConnection(Tracker tracker) : base(tracker) { }
    protected override void Dispose(bool disposing)
    {
        tracker.Events.Add("return" + Id);
        base.Dispose(disposing);
    }
}

public sealed class Transaction : IDisposable
{
    private readonly Tracker tracker;
    private readonly Connection connection;
    private bool completed;
    public Transaction(Connection connection, Tracker tracker) { this.connection = connection; this.tracker = tracker; tracker.Events.Add("begin" + connection.Id); }
    public void Commit() { completed = true; tracker.Events.Add("commit" + connection.Id); }
    public void Dispose() { if (!completed) tracker.Events.Add("rollback" + connection.Id); }
}

public static class Program
{
    private static readonly Tracker tracker = new Tracker();

    private static int Transfer(bool fail, bool commit)
    {
        using var connection = new PooledConnection(tracker);
        using (var transaction = connection.Begin())
        {
            if (fail) throw new InvalidOperationException("transfer failed");
            if (commit) transaction.Commit();
            else return -connection.Id;
        }
        return connection.Id;
    }

    private static IEnumerable<int> Guarded(int count)
    {
        using (tracker.Scope("iter"))
        {
            for (int i = 0; i < count; i++)
            {
                using var item = tracker.Scope("i" + i);
                yield return i;
            }
        }
    }

    private static string ReadAll(TextReader reader)
    {
        using (reader)
        using (var writer = new StringWriter())
        {
            string line;
            while ((line = reader.ReadLine()) != null) writer.Write(line.Trim() + ";");
            return writer.ToString();
        }
    }

    private static string Nested(int depth)
    {
        if (depth == 0) return "bottom";
        using (tracker.Scope("d" + depth))
        {
            try { return Nested(depth - 1) + "<" + depth; }
            finally { tracker.Events.Add("f" + depth); }
        }
    }

    public static void Main()
    {
        Console.WriteLine(Transfer(false, true) + " " + tracker.Drain());
        Console.WriteLine(Transfer(false, false) + " " + tracker.Drain());
        try { Transfer(true, true); } catch (InvalidOperationException e) { Console.WriteLine(e.Message + " " + tracker.Drain()); }
        try { using var broken = new Connection(tracker, fail: true); } catch (IOException e) { Console.WriteLine(e.Message + " [" + tracker.Drain() + "]"); }

        Console.WriteLine(string.Join("", Guarded(3)) + " " + tracker.Drain());
        Console.WriteLine(Guarded(5).First() + " " + tracker.Drain());
        foreach (int value in Guarded(5)) { if (value == 1) break; }
        Console.WriteLine(tracker.Drain());
        var enumerator = Guarded(2).GetEnumerator();
        enumerator.MoveNext();
        Console.WriteLine("abandoned: " + tracker.Drain());
        enumerator.Dispose();
        Console.WriteLine("disposed: " + tracker.Drain());

        Console.WriteLine(ReadAll(new StringReader(" one \n two\n\nthree ")) + " " + Nested(3) + " " + tracker.Drain());
        IDisposable nothing = null;
        using (nothing) { tracker.Events.Add("null resource is fine"); }
        using (IDisposable first = tracker.Scope("a"), second = tracker.Scope("b")) { tracker.Events.Add("both"); }
        var shared = tracker.Scope("shared");
        using (shared) using (shared) { }
        Console.WriteLine(tracker.Drain());

        var order = new List<string>();
        try
        {
            using var outer = new Connection(tracker);
            try
            {
                using var inner = new Connection(tracker);
                using var transaction = inner.Begin();
                order.Add("work");
                throw new TimeoutException("slow");
            }
            catch (TimeoutException e) when (order.Count == 1)
            {
                order.Add("caught " + e.Message);
                outer.Dispose();
                outer.Begin();
            }
            finally { order.Add("inner finally"); }
        }
        catch (ObjectDisposedException e) { order.Add("disposed " + e.ObjectName); }
        finally { order.Add("outer finally"); }
        Console.WriteLine(string.Join(", ", order) + " | " + tracker.Drain());
        using var stream = new MemoryStream();
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 64, leaveOpen: true)) { writer.Write("héllo"); writer.Write(42); }
        stream.Position = 0;
        using var streamReader = new StreamReader(stream);
        Console.WriteLine(stream.Length + " " + streamReader.ReadToEnd() + " " + stream.CanRead);
    }
}
