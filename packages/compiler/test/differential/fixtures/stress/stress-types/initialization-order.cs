using System;
using System.Collections.Generic;

public static class Trace
{
    public static readonly List<string> Entries = new List<string>();
    public static int Log(string entry, int value = 0)
    {
        Entries.Add(entry);
        return value;
    }
    public static void Flush(string title)
    {
        Console.WriteLine(title + ": " + string.Join(", ", Entries));
        Entries.Clear();
    }
}

public class Base
{
    private static readonly int staticField = Trace.Log("Base.staticField", 1);
    private readonly int instanceField = Trace.Log("Base.instanceField", 2);
    protected int fromVirtual;

    static Base() { Trace.Log("Base.cctor"); }

    public Base() : this(Trace.Log("Base() argument", 5)) { Trace.Log("Base() body"); }

    public Base(int seed)
    {
        Trace.Log("Base(int) body " + seed);
        fromVirtual = Describe();
    }

    public virtual int Describe() => Trace.Log("Base.Describe", instanceField + staticField);
    public static int StaticValue => staticField;
}

public class Derived : Base
{
    private static int counter = Trace.Log("Derived.counter", 10);
    private readonly string name = "field" + Trace.Log("Derived.name");
    private readonly List<int> items = new List<int> { Trace.Log("Derived.items[0]", 7) };
    public int Auto { get; } = Trace.Log("Derived.Auto", 3);

    static Derived() { Trace.Log("Derived.cctor"); counter++; }

    public Derived() { Trace.Log("Derived() body " + name + " " + items.Count + " " + Auto + " " + fromVirtual); }

    public Derived(string label) : base(Trace.Log("Derived(string) base argument", 9))
    {
        Trace.Log("Derived(string) body " + label);
    }

    public override int Describe() => Trace.Log("Derived.Describe name=" + (name ?? "null"), 100 + counter);
    public static int Counter => counter;
}

public class Lazy
{
    public static readonly Lazy Instance = new Lazy();
    public static int Created = Trace.Log("Lazy.Created", 0);
    private Lazy() { Created++; Trace.Log("Lazy.ctor created=" + Created); }
    public static void Touch() { Trace.Log("Lazy.Touch created=" + Created); }
}

public struct Settings
{
    public int Width = Trace.Log("Settings.Width", 80);
    public string Title { get; set; } = "untitled";
    public Settings() { Trace.Log("Settings()"); }
    public Settings(string title) : this() { Title = title; Trace.Log("Settings(string)"); }
}

public class Generic<T>
{
    public static readonly string Name = "Generic<" + typeof(T).Name + ">" + Trace.Log("Generic<" + typeof(T).Name + ">.Name");
    public static int Instances;
    public Generic() { Instances++; }
}

public sealed class Singleton
{
    private static Singleton instance;
    private static int creations;
    private Singleton() { creations++; }
    public static Singleton Instance => instance ??= new Singleton();
    public static int Creations => creations;
}

public static class Program
{
    private static readonly int first = Trace.Log("Program.first", 1);
    private static readonly int second = first + Trace.Log("Program.second", 1);
    private const int Constant = 40 + 2;

    public static void Main()
    {
        Trace.Flush("startup");
        Console.WriteLine(second + Constant);
        var derived = new Derived();
        Trace.Flush("new Derived()");
        var labelled = new Derived("x");
        Trace.Flush("new Derived(string)");
        Console.WriteLine(derived.Describe() + " " + Base.StaticValue + " " + Derived.Counter + " " + labelled.Auto);
        Trace.Flush("calls");
        new Base();
        Trace.Flush("new Base()");
        Lazy.Touch();
        Trace.Flush("Lazy");
        var defaulted = default(Settings);
        var constructed = new Settings();
        var titled = new Settings("report") { Width = 120 };
        Console.WriteLine($"{defaulted.Width}/{defaulted.Title ?? "null"} {constructed.Width}/{constructed.Title} {titled.Width}/{titled.Title}");
        Trace.Flush("Settings");
        new Generic<int>(); new Generic<int>(); new Generic<string>();
        Console.WriteLine(Generic<int>.Name + Generic<int>.Instances + " " + Generic<string>.Name + Generic<string>.Instances + " " + Generic<double>.Instances);
        Trace.Flush("Generic");
        Console.WriteLine(ReferenceEquals(Singleton.Instance, Singleton.Instance) + " " + Singleton.Creations);
        var array = new Settings[2];
        Console.WriteLine(array[1].Width + " " + (array[1].Title == null));
        Trace.Flush("end");
    }
}
