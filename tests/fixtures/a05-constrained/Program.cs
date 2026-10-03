using System;
struct Plain { public int Number; }
struct Override
{
    public int Number;
    public override string ToString() => "override";
    public override int GetHashCode() => Number;
    public override bool Equals(object other) => other is Override value && value.Number == Number;
}
class Reference
{
    public override string ToString() => "reference";
    public override int GetHashCode() => 123;
    public override bool Equals(object other) => other is Reference;
}
class Program
{
    static void Print<T>(T value, T equal)
    {
        Console.WriteLine(value.ToString());
        Console.WriteLine(value.Equals(equal));
        Console.WriteLine(value.GetHashCode() == equal.GetHashCode());
    }
    static void Main()
    {
        Print(42, 42);
        Print(new Plain { Number = 42 }, new Plain { Number = 42 });
        Print(new Override { Number = 123 }, new Override { Number = 123 });
        Print(new Reference(), new Reference());
    }
}
