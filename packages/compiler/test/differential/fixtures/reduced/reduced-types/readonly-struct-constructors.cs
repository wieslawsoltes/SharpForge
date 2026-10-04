using System;
public readonly struct A
{
    private readonly int from;
    public A(int from) { this.from = from; }
    public int From => from;
}
public readonly struct B
{
    public readonly double X, Y;
    public B(double x, double y) { X = x; Y = y; }
}
public readonly struct C<T>
{
    private readonly T value;
    private C(T value) { this.value = value; HasValue = true; }
    public bool HasValue { get; }
    public static C<T> Some(T value) => new C<T>(value);
    public T Value => value;
}
public struct D
{
    public readonly int Fixed;
    public int Free;
    public D(int a) { Fixed = a; Free = a; }
    public readonly int Sum() => Fixed + Free;
}
public static class Program
{
    public static void Main()
    {
        Console.WriteLine(new A(3).From + " " + new B(1, 2).Y + " " + C<string>.Some("x").Value + C<int>.Some(1).HasValue + " " + new D(4).Sum());
    }
}
