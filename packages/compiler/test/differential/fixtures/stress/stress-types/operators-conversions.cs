using System;
using System.Collections.Generic;

public readonly struct Celsius
{
    public Celsius(double degrees) { Degrees = degrees; }
    public double Degrees { get; }
    public static implicit operator Celsius(double degrees) => new Celsius(degrees);
    public static explicit operator double(Celsius c) => c.Degrees;
    public static explicit operator Fahrenheit(Celsius c) => new Fahrenheit(c.Degrees * 9 / 5 + 32);
    public static Celsius operator +(Celsius a, Celsius b) => new Celsius(a.Degrees + b.Degrees);
    public static Celsius operator ++(Celsius a) => new Celsius(a.Degrees + 1);
    public static bool operator <(Celsius a, Celsius b) => a.Degrees < b.Degrees;
    public static bool operator >(Celsius a, Celsius b) => a.Degrees > b.Degrees;
    public static bool operator true(Celsius a) => a.Degrees > 0;
    public static bool operator false(Celsius a) => a.Degrees <= 0;
    public static Celsius operator &(Celsius a, Celsius b) => a.Degrees < b.Degrees ? a : b;
    public static Celsius operator |(Celsius a, Celsius b) => a.Degrees > b.Degrees ? a : b;
    public static Celsius operator !(Celsius a) => new Celsius(-a.Degrees);
    public override string ToString() => Degrees + "C";
}

public readonly struct Fahrenheit
{
    public Fahrenheit(double degrees) { Degrees = degrees; }
    public double Degrees { get; }
    public static implicit operator Celsius(Fahrenheit f) => new Celsius((f.Degrees - 32) * 5 / 9);
    public override string ToString() => Degrees + "F";
}

public sealed class Money
{
    public Money(long cents) { Cents = cents; }
    public long Cents { get; }
    public static implicit operator Money(int units) => new Money(units * 100L);
    public static implicit operator Money(string text) => new Money(long.Parse(text.Replace(".", "")));
    public static explicit operator long(Money m) => m.Cents;
    public static explicit operator int(Money m) => checked((int)(m.Cents / 100));
    public static Money operator +(Money a, Money b) => new Money(a.Cents + b.Cents);
    public static Money operator *(Money a, int k) => new Money(a.Cents * k);
    public static Money operator *(int k, Money a) => a * k;
    public static Money operator %(Money a, int k) => new Money(a.Cents % k);
    public static Money operator -(Money a) => new Money(-a.Cents);
    public static Money operator <<(Money a, int shift) => new Money(a.Cents << shift);
    public static bool operator ==(Money a, Money b) => a?.Cents == b?.Cents;
    public static bool operator !=(Money a, Money b) => !(a == b);
    public override bool Equals(object obj) => obj is Money m && m.Cents == Cents;
    public override int GetHashCode() => Cents.GetHashCode();
    public override string ToString() => (Cents / 100) + "." + (Math.Abs(Cents) % 100).ToString("00");
}

public class Animal { public override string ToString() => "animal"; }
public class Cat : Animal { public override string ToString() => "cat"; }

public static class Overloads
{
    public static string Pick(int value) => "int";
    public static string Pick(long value) => "long";
    public static string Pick(double value) => "double";
    public static string Pick(object value) => "object";
    public static string Pick(string value) => "string";
    public static string Pick<T>(T value) => "T=" + typeof(T).Name;
    public static string Pick<T>(IEnumerable<T> values) => "IEnumerable<" + typeof(T).Name + ">";
    public static string Pick(params int[] values) => "params int[" + values.Length + "]";
    public static string Pick(Animal animal) => "Animal";
    public static string Pick(Celsius celsius) => "Celsius";

    public static string Two(int a, double b) => "int,double";
    public static string Two(double a, int b) => "double,int";
    public static string Nullable(int? value) => "int?";
    public static string Nullable(object value) => "object";
    public static string Fun(Func<int> f) => "Func<int>";
    public static string Fun(Func<string> f) => "Func<string>";
    public static string Fun(Action a) => "Action";
}

public static class Program
{
    public static void Main()
    {
        Celsius cold = -5, warm = 25.5;
        Celsius sum = cold + warm + 1;
        var boiling = (Fahrenheit)new Celsius(100);
        Celsius back = boiling;
        sum++;
        Console.WriteLine($"{sum} {boiling} {back} {(double)warm + 1} {(cold < warm)} {!cold} {cold && warm} {cold || warm} {warm && sum} {(warm ? "positive" : "not")}");
        var post = sum++;
        var pre = ++sum;
        Console.WriteLine(post + " " + pre + " " + sum);

        Money wallet = 12;
        Money price = "3.49";
        wallet += price;
        wallet *= 2;
        Money none = null;
        Console.WriteLine($"{wallet} {3 * price} {-price} {wallet % 1000} {price << 1} {(long)wallet} {(int)wallet} {wallet == 3098} {wallet != price} {none == null} {none != wallet}");
        try { Console.WriteLine((int)new Money(long.MaxValue)); }
        catch (OverflowException) { Console.WriteLine("overflow"); }

        byte b = 1; short s = 2; char c = 'c'; float f = 1f; uint u = 3; decimal m = 1m; long big = 5;
        Console.WriteLine(string.Join(" ", Overloads.Pick(b), Overloads.Pick(s), Overloads.Pick(c), Overloads.Pick(f), Overloads.Pick(u), Overloads.Pick(m), Overloads.Pick(big)));
        Console.WriteLine(string.Join(" ", Overloads.Pick("s"), Overloads.Pick((object)"s"), Overloads.Pick(new Cat()), Overloads.Pick(new[] { 1 }), Overloads.Pick(new List<string>()), Overloads.Pick(1, 2), Overloads.Pick()));
        Console.WriteLine(string.Join(" ", Overloads.Pick(warm), Overloads.Pick(1.5), Overloads.Pick(boiling), Overloads.Pick<Animal>(new Cat()), Overloads.Pick((Animal)new Cat()), Overloads.Pick(1 > 0), Overloads.Pick((1, 2))));
        Console.WriteLine(string.Join(" ", Overloads.Two(1, 1.0), Overloads.Two(1.0, 1), Overloads.Two(b, 1.5f), Overloads.Two(2.5f, s), Overloads.Nullable(1), Overloads.Nullable(null), Overloads.Nullable(s), Overloads.Nullable("x"), Overloads.Nullable(1L)));
        Console.WriteLine(string.Join(" ", Overloads.Fun(() => 1), Overloads.Fun(() => "s"), Overloads.Fun(() => { }), Overloads.Fun(() => Console.Write(""))));

        int i = 7;
        long l = i;
        double d = l / 2;
        double exact = l / 2.0;
        var mixed = i + 1.5f;
        var wide = u + i;
        var ch = c + 1;
        var shortSum = s + s;
        object boxed = i;
        Console.WriteLine($"{d} {exact} {mixed.GetType().Name} {wide.GetType().Name} {ch.GetType().Name}:{ch} {shortSum.GetType().Name} {(char)(c + 1)} {(byte)(b + 255)} {boxed is long} {boxed is int} {(long)(int)boxed} {(i / 2) * 2.0} {i % 3 * -1} {-i / 2} {-i % 4}");
        s += 1; b *= 200; c++; f /= 3;
        Console.WriteLine($"{s} {b} {c} {f:F4} {(int)3.99} {(int)-3.99} {(uint)3.99} {unchecked((byte)-1)} {unchecked((sbyte)200)} {(char)65} {(int)'€'} {(decimal)0.1f} {(float)0.1m}");
    }
}
