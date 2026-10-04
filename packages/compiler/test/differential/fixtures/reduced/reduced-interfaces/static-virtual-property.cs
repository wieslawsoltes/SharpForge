using System;
public interface IShape<TSelf> where TSelf : IShape<TSelf>
{
    static abstract string Kind { get; }
    static virtual int Sides => 0;
    static virtual string Describe() => TSelf.Kind + "/" + TSelf.Sides;
}
public struct Square : IShape<Square>
{
    public static string Kind => "square";
    public static int Sides => 4;
}
public struct Circle : IShape<Circle>
{
    public static string Kind => "circle";
    public static string Describe() => "round";
}
public static class Program
{
    static string Show<T>() where T : IShape<T> => T.Kind + " " + T.Sides + " " + T.Describe();
    public static void Main()
    {
        Console.WriteLine(Show<Square>());
        Console.WriteLine(Show<Circle>());
    }
}
