using System;
using System.Collections.Generic;
using System.Linq;

// Reduced from stress-interfaces/default-members-diamond: a static abstract or virtual interface member named through
// a type parameter and converted to a delegate (`T.Create`) is looked up on the type argument (`constrained.` `ldftn`).
public interface IFactory<TSelf> where TSelf : IFactory<TSelf>
{
    static abstract TSelf Create(string argument);
    static virtual string Describe(TSelf value) => "generic " + value.Text;
    string Text { get; }
}

public sealed class Meter : IFactory<Meter>
{
    public int Value;
    public string Text => Value + "m";
    public static Meter Create(string argument) => new Meter { Value = int.Parse(argument) };
    public static string Describe(Meter value) => "meter " + value.Text;
}

public readonly struct Label : IFactory<Label>
{
    private readonly string text;
    public Label(string text) { this.text = text; }
    public string Text => "'" + text + "'";
    public static Label Create(string argument) => new Label(argument);
}

public static class Program
{
    private static List<T> MakeMany<T>(params string[] arguments) where T : IFactory<T> => arguments.Select(T.Create).ToList();

    private static string DescribeAll<T>(IEnumerable<T> values) where T : IFactory<T>
    {
        Func<T, string> describe = T.Describe;
        Func<string, T> create = T.Create;
        return string.Join(",", values.Select(describe)) + " + " + describe(create("9"));
    }

    public static void Main()
    {
        List<Meter> meters = MakeMany<Meter>("1", "2", "3");
        Console.WriteLine(meters.Sum(meter => meter.Value) + " " + DescribeAll(meters));
        Console.WriteLine(DescribeAll(MakeMany<Label>("a", "b")));
    }
}
