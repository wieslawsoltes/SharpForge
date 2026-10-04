using System;
using System.Collections.Generic;
using System.Linq;

public abstract class Serializer
{
    public abstract string Write<T>(T value);
    public virtual string WriteAll<T>(IEnumerable<T> values) => "[" + string.Join(",", values.Select(Write)) + "]";
    public virtual T Echo<T>(T value) where T : class => value;
    public string Name => GetType().Name;
}

public class PlainSerializer : Serializer
{
    public override string Write<T>(T value) => value?.ToString() ?? "null";
}

public class TypedSerializer : PlainSerializer
{
    public override string Write<T>(T value) => typeof(T).Name + ":" + base.Write(value);
    public override string WriteAll<T>(IEnumerable<T> values) => typeof(T).Name + base.WriteAll(values);
    public override T Echo<T>(T value) => base.Echo(value) ?? throw new ArgumentNullException(nameof(value));
}

public sealed class QuotingSerializer : TypedSerializer
{
    public override string Write<T>(T value) => value is string ? "\"" + value + "\"" : base.Write(value);
}

public abstract class Handler<TMessage>
{
    public abstract string Handle(TMessage message);
    public virtual string HandleMany(params TMessage[] messages) => string.Join("|", messages.Select(Handle));
}

public class TextHandler : Handler<string>
{
    public override string Handle(string message) => message.ToUpperInvariant();
}

public class ListHandler<T> : Handler<List<T>>
{
    public override string Handle(List<T> message) => message.Count + ":" + string.Join("", message);
    public override string HandleMany(params List<T>[] messages) => "{" + base.HandleMany(messages) + "}";
}

public sealed class IntListHandler : ListHandler<int>
{
    public override string Handle(List<int> message) => base.Handle(message) + "=" + message.Sum();
}

public abstract class Shape
{
    public abstract Shape Clone();
    public virtual Shape Scale(double factor) => this;
    public abstract double Area { get; }
}

public class Circle : Shape
{
    public double Radius { get; init; }
    public override Circle Clone() => new Circle { Radius = Radius };
    public override Circle Scale(double factor) => new Circle { Radius = Radius * factor };
    public override double Area => Math.Round(Math.PI * Radius * Radius, 2);
}

public sealed class Ring : Circle
{
    public double Hole { get; init; }
    public override Ring Clone() => new Ring { Radius = Radius, Hole = Hole };
    public override double Area => Math.Round(base.Area - Math.PI * Hole * Hole, 2);
}

public interface IConverter<in TSource, out TTarget> { TTarget Convert(TSource source); }

public abstract class Pipeline<TIn, TOut> : IConverter<TIn, TOut>
{
    public abstract TOut Convert(TIn source);
    public Pipeline<TIn, TNext> Then<TNext>(IConverter<TOut, TNext> next) => new Chained<TNext>(this, next);

    private sealed class Chained<TNext> : Pipeline<TIn, TNext>
    {
        private readonly Pipeline<TIn, TOut> first;
        private readonly IConverter<TOut, TNext> second;
        public Chained(Pipeline<TIn, TOut> first, IConverter<TOut, TNext> second) { this.first = first; this.second = second; }
        public override TNext Convert(TIn source) => second.Convert(first.Convert(source));
    }
}

public sealed class Lambda<TIn, TOut> : Pipeline<TIn, TOut>
{
    private readonly Func<TIn, TOut> function;
    public Lambda(Func<TIn, TOut> function) { this.function = function; }
    public override TOut Convert(TIn source) => function(source);
}

public static class Program
{
    public static void Main()
    {
        Serializer[] serializers = { new PlainSerializer(), new TypedSerializer(), new QuotingSerializer() };
        foreach (var serializer in serializers)
        {
            object boxed = 2.5;
            Console.WriteLine($"{serializer.Name}: {serializer.Write(42)} {serializer.Write("text")} {serializer.Write<object>("text")} {serializer.Write(boxed)} {serializer.Write<string>(null)} {serializer.Write((1, 'c'))} {serializer.WriteAll(new[] { 1, 2 })} {serializer.WriteAll(new List<string> { "a" })} {serializer.Echo("echo")}");
        }
        try { serializers[1].Echo<string>(null); } catch (ArgumentNullException e) { Console.WriteLine("null " + e.ParamName); }
        Console.WriteLine(serializers[0].Echo<string>(null) == null);

        Handler<string> text = new TextHandler();
        Handler<List<int>> ints = new IntListHandler();
        ListHandler<char> chars = new ListHandler<char>();
        Console.WriteLine(text.HandleMany("a", "b") + " " + text.HandleMany() + " " + ints.HandleMany(new List<int> { 1, 2 }, new List<int>()) + " " + chars.Handle(new List<char> { 'x', 'y' }) + " " + chars.HandleMany(new List<char>()));

        Shape shape = new Ring { Radius = 2, Hole = 1 };
        Shape clone = shape.Clone();
        Circle circle = new Circle { Radius = 1 };
        Circle scaled = circle.Scale(3);
        Ring ring = ((Ring)shape).Clone();
        Shape scaledRing = shape.Scale(2);
        Console.WriteLine(clone.GetType().Name + " " + clone.Area + " " + ReferenceEquals(clone, shape) + " " + scaled.Radius + " " + scaled.Area + " " + ring.Hole + " " + scaledRing.GetType().Name + " " + scaledRing.Area + " " + circle.Clone().Scale(2).Clone().Radius);

        var pipeline = new Lambda<string, int>(int.Parse).Then(new Lambda<int, double>(n => n / 4.0)).Then(new Lambda<double, string>(d => d.ToString("F2", System.Globalization.CultureInfo.InvariantCulture))).Then(new Lambda<object, int>(o => o.ToString().Length));
        IConverter<string, int> widened = pipeline;
        Console.WriteLine(pipeline.Convert("10") + " " + widened.Convert("1000") + " " + pipeline.GetType().Name.StartsWith("Chained") + " " + new Lambda<int, int>(x => x + 1).Then(new Lambda<int, int>(x => x * 2)).Convert(5));
    }
}
