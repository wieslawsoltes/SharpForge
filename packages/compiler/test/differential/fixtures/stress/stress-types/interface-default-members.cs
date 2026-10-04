using System;
using System.Collections.Generic;
using System.Linq;

public interface ILogger
{
    void Write(string message);
    void Info(string message) => Write("INFO " + message);
    void Error(string message) => Write("ERROR " + message);
    static int Created { get; private set; }
    static ILogger Create(List<string> sink) { Created++; return new ListLogger(sink); }
    protected static string Decorate(string text) => "<" + text + ">";
    string Name => GetType().Name;
}

public sealed class ListLogger : ILogger
{
    private readonly List<string> sink;
    public ListLogger(List<string> sink) { this.sink = sink; }
    public void Write(string message) => sink.Add(message);
}

public sealed class LoudLogger : ILogger
{
    private readonly List<string> sink;
    public LoudLogger(List<string> sink) { this.sink = sink; }
    public void Write(string message) => sink.Add(message.ToUpperInvariant());
    public void Error(string message) => Write("!!! " + message);
    string ILogger.Name => "loud";
}

public interface IShape
{
    double Area { get; }
    double Perimeter { get; }
    string Describe() => $"{Kind} area={Area:0.##} perimeter={Perimeter:0.##}";
    string Kind => "shape";
}

public interface IScalable<TSelf> where TSelf : IScalable<TSelf>
{
    TSelf Scale(double factor);
    TSelf Double() => Scale(2);
}

public readonly struct Rect : IShape, IScalable<Rect>
{
    public Rect(double width, double height) { Width = width; Height = height; }
    public double Width { get; }
    public double Height { get; }
    public double Area => Width * Height;
    public double Perimeter => 2 * (Width + Height);
    public string Kind => Width == Height ? "square" : "rect";
    public Rect Scale(double factor) => new Rect(Width * factor, Height * factor);
}

public class Disc : IShape, IScalable<Disc>
{
    public Disc(double radius) { Radius = radius; }
    public double Radius { get; }
    public double Area => 3 * Radius * Radius;
    public double Perimeter => 6 * Radius;
    public Disc Scale(double factor) => new Disc(Radius * factor);
    public virtual string Describe() => "disc r=" + Radius;
}

public interface IA { string Who() => "IA"; }
public interface IB : IA { string IA.Who() => "IB"; }
public interface IC : IA { string IA.Who() => "IC"; }
public class Diamond : IB, IC { string IA.Who() => "Diamond"; }
public class OnlyB : IB { }
public class Plain : IA { public string Who() => "Plain"; }

public interface ICounter
{
    int Count { get; set; }
    int Increment() => ++Count;
    int this[int offset] => Count + offset;
    event Action<int> Changed;
}

public class Counter : ICounter
{
    private int count;
    public int Count
    {
        get => count;
        set { count = value; Changed?.Invoke(value); }
    }
    public event Action<int> Changed;
}

public static class Program
{
    private static T Twice<T>(T value) where T : IScalable<T> => value.Double().Double();

    public static void Main()
    {
        var sink = new List<string>();
        ILogger plain = ILogger.Create(sink), loud = new LoudLogger(sink);
        foreach (var logger in new[] { plain, loud })
        {
            logger.Info("started");
            logger.Error("failed");
            logger.Write(logger.Name);
        }
        Console.WriteLine(string.Join(" | ", sink) + " created=" + ILogger.Created);

        IShape[] shapes = { new Rect(2, 3), new Rect(2, 2), new Disc(1) };
        foreach (var shape in shapes) Console.WriteLine(shape.Describe() + " / " + shape.Kind);
        Console.WriteLine(new Disc(2).Describe() + " " + ((IShape)new Disc(2)).Describe());
        Console.WriteLine(Twice(new Rect(1, 2)).Area + " " + Twice(new Disc(1)).Radius + " " + ((IScalable<Rect>)new Rect(1, 1)).Double().Perimeter);

        IA[] all = { new Diamond(), new OnlyB(), new Plain() };
        Console.WriteLine(string.Join(",", all.Select(a => a.Who())) + " " + new Plain().Who() + " " + ((IB)new Diamond()).Who());

        var counter = new Counter();
        var seen = new List<int>();
        counter.Changed += seen.Add;
        ICounter view = counter;
        view.Increment();
        view.Increment();
        view.Count += 10;
        Console.WriteLine(view.Count + " " + view[5] + " " + string.Join(",", seen));
    }
}
