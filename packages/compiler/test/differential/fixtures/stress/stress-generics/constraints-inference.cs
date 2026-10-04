using System;
using System.Collections.Generic;
using System.Linq;

public interface IIdentified { int Id { get; } }
public interface IFactory<out T> { T Create(int seed); }
public abstract class Widget : IIdentified, IComparable<Widget>
{
    public int Id { get; set; }
    public abstract string Kind { get; }
    public int CompareTo(Widget other) => Id.CompareTo(other.Id);
    public override string ToString() => Kind + Id;
}
public class Button : Widget { public override string Kind => "button"; }
public class Label : Widget { public override string Kind => "label"; public Label() { Id = 100; } }
public struct Handle : IIdentified { public int Id { get; set; } }

public sealed class Pool<T> where T : class, IIdentified, new()
{
    private readonly Stack<T> free = new Stack<T>();
    public int Created { get; private set; }
    public T Rent()
    {
        if (free.Count > 0) return free.Pop();
        Created++;
        return new T();
    }
    public void Return(T item) => free.Push(item);
}

public sealed class Factory<T> : IFactory<T> where T : Widget, new()
{
    public T Create(int seed) => new T { Id = seed };
}

public static class Generic
{
    public static T Max<T>(T first, params T[] rest) where T : IComparable<T>
    {
        T best = first;
        foreach (var item in rest) if (item.CompareTo(best) > 0) best = item;
        return best;
    }

    public static TValue GetOrCreate<TKey, TValue>(this IDictionary<TKey, TValue> map, TKey key) where TValue : new()
    {
        if (!map.TryGetValue(key, out var value)) map[key] = value = new TValue();
        return value;
    }

    public static int SumIds<T>(IEnumerable<T> items) where T : IIdentified => items.Sum(item => item.Id);
    public static T? FirstOrNull<T>(IEnumerable<T> items, Func<T, bool> predicate) where T : struct
    {
        foreach (var item in items) if (predicate(item)) return item;
        return null;
    }
    public static TOut[] Convert<TIn, TOut>(TIn[] items) where TOut : class where TIn : class => items.Select(item => item as TOut).ToArray();
    public static bool IsDefault<T>(T value) => EqualityComparer<T>.Default.Equals(value, default);
    public static string TypeName<T>() => typeof(T).Name;
    public static string Describe<T>(T value) => value is null ? "null:" + typeof(T).Name : value.GetType().Name + ":" + typeof(T).Name;
    public static TEnum Parse<TEnum>(string text) where TEnum : struct, Enum => Enum.Parse<TEnum>(text, true);
    public static int SizeOf<T>() where T : unmanaged => System.Runtime.CompilerServices.Unsafe.SizeOf<T>();
    public static void Swap<T>(ref T a, ref T b) => (a, b) = (b, a);
    public static TResult Apply<T, TResult>(T value, Func<T, TResult> function) => function(value);
    public static Func<T, T> Chain<T>(params Func<T, T>[] steps) => value => steps.Aggregate(value, (current, step) => step(current));
    public static List<TBase> Upcast<TDerived, TBase>(IEnumerable<TDerived> items) where TDerived : TBase => items.Select(item => (TBase)item).ToList();
    public static TDelegate Combine<TDelegate>(TDelegate a, TDelegate b) where TDelegate : Delegate => (TDelegate)Delegate.Combine(a, b);
}

public static class Program
{
    public static void Main()
    {
        var pool = new Pool<Button>();
        var first = pool.Rent();
        var second = pool.Rent();
        pool.Return(first);
        Console.WriteLine(ReferenceEquals(pool.Rent(), first) + " " + pool.Created + " " + ReferenceEquals(first, second));

        IFactory<Widget> factory = new Factory<Button>();
        IFactory<object> objects = new Factory<Label>();
        var widgets = new List<Widget> { factory.Create(3), (Widget)objects.Create(1), new Factory<Label>().Create(2), new Label() };
        widgets.Sort();
        Console.WriteLine(string.Join(" ", widgets) + " " + Generic.Max(widgets[0], widgets[1], widgets[3]) + " " + Generic.SumIds(widgets) + " " + Generic.SumIds(new[] { new Handle { Id = 4 }, new Handle { Id = 5 } }));
        Console.WriteLine(Generic.Max(3, 9, 4) + " " + Generic.Max("pear", "apple") + " " + Generic.Max(2.5) + " " + Generic.Max('a', 'z', 'm') + " " + Generic.Max(TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(3)).TotalSeconds + " " + Generic.Max(new Version(1, 2), new Version(1, 10)));

        var index = new Dictionary<string, List<int>>();
        index.GetOrCreate("a").Add(1);
        index.GetOrCreate("a").Add(2);
        index.GetOrCreate("b");
        var counts = new Dictionary<char, int>();
        foreach (char c in "hello") counts[c] = counts.GetOrCreate(c) + 1;
        Console.WriteLine(index["a"].Count + " " + index["b"].Count + " " + counts['l'] + counts['o']);

        int? found = Generic.FirstOrNull(new[] { 1, 5, 8 }, n => n > 4), none = Generic.FirstOrNull(new[] { 1 }, n => n > 4);
        Console.WriteLine(found + " " + none.HasValue + " " + Generic.FirstOrNull(new[] { DayOfWeek.Sunday }, d => true) + " " + string.Join(",", Generic.Convert<object, string>(new object[] { "a", 1, "b" }).Select(s => s ?? "-")));
        Console.WriteLine(Generic.IsDefault(0) + " " + Generic.IsDefault("") + " " + Generic.IsDefault<string>(null) + " " + Generic.IsDefault(default(Handle)) + " " + Generic.IsDefault(new Handle { Id = 1 }) + " " + Generic.IsDefault<int?>(null) + " " + Generic.IsDefault(0.0));
        Console.WriteLine(Generic.TypeName<int>() + " " + Generic.TypeName<List<string>>() + " " + Generic.TypeName<int[]>() + " " + Generic.TypeName<(int, string)>() + " " + Generic.TypeName<int?>() + " " + Generic.TypeName<Dictionary<string, int>.Enumerator>());
        Widget asBase = new Button();
        object boxed = 5;
        Console.WriteLine(Generic.Describe(asBase) + " " + Generic.Describe(boxed) + " " + Generic.Describe<string>(null) + " " + Generic.Describe(5) + " " + Generic.Describe<IIdentified>(new Handle()) + " " + Generic.Describe((int?)null) + " " + Generic.Describe((int?)3));
        Console.WriteLine(Generic.Parse<DayOfWeek>("friday") + " " + Generic.Parse<ConsoleColor>("RED") + " " + Generic.SizeOf<int>() + Generic.SizeOf<long>() + Generic.SizeOf<char>() + Generic.SizeOf<decimal>() + Generic.SizeOf<Guid>());
        string left = "L", right = "R";
        Generic.Swap(ref left, ref right);
        var pair = (1, 2);
        Generic.Swap(ref pair.Item1, ref pair.Item2);
        Console.WriteLine(left + right + pair + " " + Generic.Apply(5, n => n * 1.5) + " " + Generic.Apply("abc", s => s.Length) + " " + Generic.Apply(new[] { 1, 2 }, items => items.Select(i => i.ToString()).ToList()).Count + " " + Generic.Chain<int>(n => n + 1, n => n * 10)(4) + " " + Generic.Chain<string>()("same"));
        List<Widget> upcast = Generic.Upcast<Button, Widget>(new[] { new Button { Id = 7 } });
        List<object> asObjects = Generic.Upcast<int, object>(new[] { 1, 2 });
        var log = new List<string>();
        var combined = Generic.Combine<Action<string>>(text => log.Add("1" + text), text => log.Add("2" + text));
        combined("x");
        Console.WriteLine(upcast[0] + " " + asObjects.Count + " " + string.Join(",", log));
    }
}
