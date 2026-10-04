using System;
using System.Text;

namespace Sample
{
    struct Cell<T>
    {
        public T Value;
        public int Count;
        public override string ToString()
        {
            Count++;
            GC.Collect();
            return "cell";
        }
    }

    struct Plain<T> { public T Value; }
    class Box<T> { public T Value; }
    class Outer<T> { public class Inner<U> { } }
}

class Program
{
    static object Box<T>(T value) { return value; }

    static void Main()
    {
        var value = new Sample.Cell<int>();
        value.Value = 17;
        object boxed = Box(value);
        var builder = new StringBuilder("|");
        builder.Insert(0, boxed);
        builder.Insert(0, boxed);
        Console.WriteLine(builder.ToString());
        Console.WriteLine(((Sample.Cell<int>)boxed).Count);
        Console.WriteLine(((Sample.Cell<int>)boxed).Value);
        Console.WriteLine(value.Count);
        Console.WriteLine(boxed.GetType().Name);
        object plain = new Sample.Plain<string>();
        Console.WriteLine(plain);
        Console.WriteLine(boxed.GetType() == plain.GetType());
        object item = new Sample.Box<int>();
        Console.WriteLine(item);
        object nested = new Sample.Outer<int>.Inner<string>();
        Console.WriteLine(nested);
        object arrays = new Sample.Box<int[,]>();
        Console.WriteLine(arrays);
    }
}
