using System;

interface IShape
{
    int Area();
}

class Square : IShape
{
    readonly int side;

    public Square(int side)
    {
        this.side = side;
    }

    public int Area()
    {
        return side * side;
    }
}

class Box<T>
{
    static int created;
    T value;

    public Box(T value)
    {
        this.value = value;
        created++;
    }

    public T Value
    {
        get { return value; }
        set { this.value = value; }
    }

    public static int Created => created;

    public Box<T> With(T other)
    {
        return new Box<T>(other);
    }

    public bool Holds(T other)
    {
        return value.Equals(other);
    }

    public U Convert<U>(U fallback)
    {
        object boxed = value;
        if (boxed is U converted) return converted;
        return fallback;
    }
}

class Pair<TFirst, TSecond>
{
    public TFirst First;
    public TSecond Second;

    public Pair<TSecond, TFirst> Swap()
    {
        var swapped = new Pair<TSecond, TFirst>();
        swapped.First = Second;
        swapped.Second = First;
        return swapped;
    }
}

class Program
{
    static T Identity<T>(T value)
    {
        return value;
    }

    static T Choose<T>(bool first, T left, T right)
    {
        T result = default(T);
        if (first) result = left;
        else result = right;
        return result;
    }

    static int TotalArea<T>(T[] shapes) where T : IShape
    {
        int total = 0;
        foreach (T shape in shapes) total += shape.Area();
        return total;
    }

    static string Describe<T>(T value)
    {
        object boxed = value;
        return boxed == null ? "null" : "value " + boxed;
    }

    static void Main()
    {
        var number = new Box<int>(5);
        var text = new Box<string>("five");
        Console.WriteLine(number.Value + text.Value.Length);
        number.Value = 8;
        Console.WriteLine(number.With(9).Value + number.Value);
        Console.WriteLine(text.With("nine").Value);
        Console.WriteLine(Box<int>.Created + " " + Box<string>.Created);
        Console.WriteLine(number.Holds(8));
        Console.WriteLine(text.Holds("other"));
        Console.WriteLine(number.Convert("fallback"));
        Console.WriteLine(number.Convert(0));

        var pair = new Pair<int, string>();
        pair.First = 1;
        pair.Second = "one";
        var swapped = pair.Swap();
        Console.WriteLine(swapped.First + swapped.Second);

        Console.WriteLine(Identity(7));
        Console.WriteLine(Identity("seven"));
        Console.WriteLine(Choose(true, 1.5, 2.5));
        Console.WriteLine(Choose(false, "left", "right"));
        Console.WriteLine(TotalArea(new Square[] { new Square(2), new Square(3) }));
        Console.WriteLine(Describe(3));
        Console.WriteLine(Describe<string>(null));
    }
}
