using System;
using System.Collections.Generic;
using System.Linq;
public static class Outer<TKey>
{
    public sealed class Cache<TValue>
    {
        public readonly struct Entry { public Entry(TValue value) { Value = value; } public TValue Value { get; } }
        public static string Describe() => typeof(TKey).Name + "," + typeof(TValue).Name;
    }
    public static Cache<TValue> Create<TValue>() => new Cache<TValue>();
}
public abstract class Serializer
{
    public abstract string Write<T>(T value);
    public virtual T Echo<T>(T value) where T : class => value;
}
public class PlainSerializer : Serializer
{
    public override string Write<T>(T value) => value?.ToString() ?? "null";
}
public class TypedSerializer : PlainSerializer
{
    public override string Write<T>(T value) => typeof(T).Name + ":" + base.Write(value);
    public override T Echo<T>(T value) => base.Echo(value) ?? throw new ArgumentNullException(nameof(value));
}
public interface IVisitor<out TResult> { TResult Visit(int value); }
public abstract class Node { public abstract TResult Accept<TResult>(IVisitor<TResult> visitor); }
public sealed class Leaf : Node { public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.Visit(7); }
public sealed class Lister : IVisitor<IEnumerable<object>> { public IEnumerable<object> Visit(int value) => new object[] { value, "x" }; }
public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Outer<string>.Cache<int>.Describe() + " " + typeof(Outer<long>.Cache<bool>.Entry).Name + " " + Outer<int>.Create<string>().GetType().Name);
        Serializer s = new TypedSerializer();
        Console.WriteLine(s.Write(42) + " " + s.Write("t") + " " + s.Echo("e"));
        Node node = new Leaf();
        Console.WriteLine(string.Join(",", node.Accept(new Lister()).Cast<object>().Select(o => o.ToString())) + " " + node.Accept(new Lister()).Count());
    }
}
