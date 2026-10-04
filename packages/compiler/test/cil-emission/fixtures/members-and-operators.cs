using System;
using System.Runtime.CompilerServices;

// A type with `operator true` / `operator false` and the logical operators: `&&` and `||` short-circuit through them.
struct Tri
{
    public int State;
    public Tri(int state) { State = state; }
    public static bool operator true(Tri value) { Console.Write("[true " + value.State + "]"); return value.State > 0; }
    public static bool operator false(Tri value) { Console.Write("[false " + value.State + "]"); return value.State < 0; }
    public static Tri operator &(Tri left, Tri right) { Console.Write("[&]"); return new Tri(left.State < right.State ? left.State : right.State); }
    public static Tri operator |(Tri left, Tri right) { Console.Write("[|]"); return new Tri(left.State > right.State ? left.State : right.State); }
    public static Tri operator !(Tri value) { return new Tri(-value.State); }
    public static implicit operator Tri(int state) { return new Tri(state); }
    public static explicit operator int(Tri value) { return value.State; }
}

class Money
{
    public int Cents;
    public Money(int cents) { Cents = cents; }
    public static Money operator +(Money left, Money right) { return new Money(left.Cents + right.Cents); }
    public static Money operator -(Money value) { return new Money(-value.Cents); }
    public static Money operator ++(Money value) { return new Money(value.Cents + 1); }
    public static bool operator <(Money left, Money right) { return left.Cents < right.Cents; }
    public static bool operator >(Money left, Money right) { return left.Cents > right.Cents; }
    public static implicit operator Money(int cents) { return new Money(cents); }
    public static explicit operator double(Money value) { return value.Cents / 100.0; }
    public override string ToString() { return Cents + "c"; }
}

// Partial methods: a definition without an implementation disappears with its calls and their arguments.
partial class Worker
{
    partial void Log(string text);
    partial void Skip(int value);
    static partial void Count(int value);
    public partial int Twice(int value);
    public void Run()
    {
        Log("a");
        Skip(Program.Next("skipped"));
        Count(2);
        Console.WriteLine(Twice(4));
    }
}

partial class Worker
{
    partial void Log(string text) { Console.WriteLine("log " + text); }
    static partial void Count(int value) { Console.WriteLine("count " + value); }
    public partial int Twice(int value) => value * 2;
}

// Events of a generic type, used from outside and inside through the instantiation.
class Counter<T>
{
    public event Action<T> Changed;
    public void Raise(T value)
    {
        if (Changed != null) Changed(value);
    }
}

class Factory
{
    public static T Make<T>() where T : new() { return new T(); }
    public static T Named<T>(string name) where T : Item, new() { return new T { Name = name }; }
}

class Item
{
    public string Name = "none";
}

class Special : Item
{
    public Special() { Name = "special"; }
}

class Program
{
    public static int Next(string label) { Console.WriteLine("next " + label); return 1; }

    static string Where(string label, [CallerLineNumber] long line = 0, [CallerMemberName] string member = "") { return label + ":" + (line > 0) + ":" + member; }

    static object Boxed([CallerLineNumber] object line = null) { return line is int; }

    static Tri Make(int state) { Console.Write("[make " + state + "]"); return new Tri(state); }

    static void Main()
    {
        Tri both = Make(1) && Make(2);
        Console.WriteLine(" " + both.State);
        Tri decided = Make(-1) && Make(2);
        Console.WriteLine(" " + decided.State);
        Tri either = Make(3) || Make(4);
        Console.WriteLine(" " + either.State);
        Tri second = Make(0) || Make(4);
        Console.WriteLine(" " + second.State);
        if (Make(5)) Console.WriteLine(" yes"); else Console.WriteLine(" no");
        Console.WriteLine(Make(0) ? " yes" : " no");
        Tri converted = 7;
        Console.WriteLine((int)!converted);

        Money price = 250;
        Money total = price + 50 + -new Money(100);
        total++;
        Console.WriteLine(total + " " + (total > price) + " " + (total < price) + " " + (double)total);

        new Worker().Run();

        var counter = new Counter<string>();
        string seen = "";
        Action<string> handler = text => seen += text;
        counter.Changed += handler;
        counter.Changed += text => seen += "!";
        counter.Raise("a");
        counter.Changed -= handler;
        counter.Raise("b");
        Console.WriteLine(seen);

        Console.WriteLine(Factory.Make<Special>().Name + " " + Factory.Make<int>() + " " + Factory.Named<Item>("made").Name);
        Console.WriteLine(Where("here") + " " + Boxed());
    }
}
