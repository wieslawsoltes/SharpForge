using System;
using System.Runtime.CompilerServices;

// Static abstract and virtual interface members (C# 11).
interface IAdd<T> where T : IAdd<T>
{
    static abstract T operator +(T a, T b);
    static abstract T operator ++(T a);
    static abstract bool operator ==(T a, T b);
    static abstract bool operator !=(T a, T b);
    static abstract T Zero { get; }
    static abstract T Parse(string text);
    static virtual string Describe() { return "number"; }
}

interface INamed
{
    static abstract string Name { get; }
}

class Num : IAdd<Num>, INamed
{
    public int V;
    public Num(int v) { V = v; }
    public static Num operator +(Num a, Num b) { return new Num(a.V + b.V); }
    public static Num operator ++(Num a) { return new Num(a.V + 1); }
    public static bool operator ==(Num a, Num b) { return a.V == b.V; }
    public static bool operator !=(Num a, Num b) { return a.V != b.V; }
    public override bool Equals(object other) { return other is Num num && num.V == V; }
    public override int GetHashCode() { return V; }
    public static Num Zero { get { return new Num(0); } }
    public static Num Parse(string text) { return new Num(text.Length); }
    public static string Name { get { return "Num"; } }
}

struct Text : IAdd<Text>, INamed
{
    public string S;
    public Text(string s) { S = s; }
    public static Text operator +(Text a, Text b) { return new Text(a.S + b.S); }
    public static Text operator ++(Text a) { return new Text(a.S + "+"); }
    public static bool operator ==(Text a, Text b) { return a.S == b.S; }
    public static bool operator !=(Text a, Text b) { return a.S != b.S; }
    public override bool Equals(object other) { return other is Text text && text.S == S; }
    public override int GetHashCode() { return 0; }
    public static Text Zero { get { return new Text(""); } }
    public static Text Parse(string text) { return new Text(text); }
    public static string Describe() { return "text"; }
    public static string Name { get { return "Text"; } }
}

// An interface indexer renamed on both sides, and an explicit implementation of a generic interface.
interface IRow
{
    [IndexerName("Row")]
    string this[int index] { get; }
}

interface ISource<T>
{
    T Next();
}

class Table : IRow, ISource<int>, ISource<string>
{
    int next;
    [IndexerName("Entry")]
    public string this[int index] { get { return "r" + index; } }
    int ISource<int>.Next() { return ++next; }
    string ISource<string>.Next() { return "s" + (++next); }
}

// C# 14 extension blocks.
static class Extensions
{
    extension(string text)
    {
        public int Twice => text.Length * 2;
        public string Framed() => "<" + text + ">" + text.Twice;
        public static string Make() => "made";
    }
    extension(int number)
    {
        public bool IsEven => number % 2 == 0;
        public int Squared => number * number;
        public int Plus(int other) => number + other.Squared;
        public static int Zero => 0;
    }
}

// C# 11 file-local types.
file class Helper
{
    public static int Value => 4;
    public int Twice(int value) => value * 2;
}

file static class Tools
{
    public static string Name(Helper helper) => "h" + helper.Twice(2);
}

class Program
{
    static T Sum<T>(T a, T b) where T : IAdd<T> { return T.Zero + a + b; }

    static T SumAll<T>(T[] items) where T : IAdd<T>
    {
        T total = T.Zero;
        foreach (T item in items) total += item;
        total++;
        return total;
    }

    static bool Same<T>(T a, T b) where T : IAdd<T> { return a == b && !(a != b); }

    static string About<T>(string text) where T : IAdd<T>, INamed { return T.Name + ":" + T.Describe() + ":" + (T.Parse(text) == T.Parse(text)); }

    static void Main()
    {
        Console.WriteLine(Sum(new Num(2), new Num(3)).V);
        Console.WriteLine(Sum(new Text("a"), new Text("b")).S);
        Console.WriteLine(SumAll(new Num[] { new Num(1), new Num(2), new Num(4) }).V);
        Console.WriteLine(SumAll(new Text[] { new Text("x"), new Text("y") }).S);
        Console.WriteLine(Same(new Num(1), new Num(1)) + " " + Same(new Text("x"), new Text("y")));
        Console.WriteLine(About<Num>("four") + " " + About<Text>("four"));

        IRow row = new Table();
        Console.WriteLine(row[2] + " " + new Table()[3]);
        var table = new Table();
        ISource<int> numbers = table;
        ISource<string> texts = table;
        Console.WriteLine(numbers.Next() + " " + texts.Next() + " " + numbers.Next());

        Console.WriteLine("abc".Twice + " " + "ab".Framed() + " " + string.Make());
        Console.WriteLine(3.IsEven + " " + 4.Squared + " " + 2.Plus(3) + " " + int.Zero);
        int seven = 7;
        Console.WriteLine(seven.Squared + " " + Extensions.get_Twice("abcd"));

        var helper = new Helper();
        Console.WriteLine(Helper.Value + " " + Tools.Name(helper));
    }
}
