using System;

class Cell<T>
{
    public T Value;
    public Cell(T value) { Value = value; }
    public T Read() => Value;
}

interface IValue<T> { T Read(); }
class Values : IValue<int>, IValue<string>
{
    int IValue<int>.Read() => 42;
    string IValue<string>.Read() => null;
}

class Base<T>
{
    public virtual U Identity<U>(U value) => value;
}
class Derived<T> : Base<T[]>
{
    public override U Identity<U>(U value) => value;
}

static class Program
{
    static T Default<T>() => default(T);
    static Type Type<T>() => typeof(T);
    static T ArrayRoundTrip<T>(T value)
    {
        var values = new T[1];
        values[0] = value;
        return (T)(object)values[0];
    }
    static void Main()
    {
        Console.WriteLine(new Cell<Cell<int>>(new Cell<int>(42)).Read().Read());
        Console.WriteLine(Default<int>());
        Console.WriteLine(Default<string>() == null);
        Console.WriteLine(Type<string>() == typeof(string));
        Console.WriteLine(ArrayRoundTrip(42));
        Console.WriteLine(((IValue<int>)new Values()).Read());
        Console.WriteLine(((IValue<string>)new Values()).Read() == null);
        Console.WriteLine(((Base<string[]>)new Derived<string>()).Identity(42));
    }
}
