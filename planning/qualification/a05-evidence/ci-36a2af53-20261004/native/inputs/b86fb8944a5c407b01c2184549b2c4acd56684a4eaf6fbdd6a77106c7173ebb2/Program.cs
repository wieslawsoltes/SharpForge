using System;

struct Point { public int X; }
struct Counter
{
    public int Value;
    public override string ToString()
    {
        Value++;
        GC.Collect();
        return "counter";
    }
}
static class Program
{
    static string Read(in Counter? value) => value.ToString();

    static void Main()
    {
        int? value = default;
        Console.WriteLine(value.HasValue);
        Console.WriteLine(value.GetValueOrDefault());
        Console.WriteLine(value.GetValueOrDefault(99));
        Console.WriteLine((object)value == null);
        value = new int?(12);
        Console.WriteLine(value.HasValue);
        Console.WriteLine(value.Value);
        int? copy = (int?)(object)value;
        value = default;
        Console.WriteLine(copy.Value);
        value = new int?(23);
        Console.WriteLine(value.ToString());
        Console.WriteLine(((object)value).GetType().Name);
        copy = (int?)(object)null;
        Console.WriteLine(copy.HasValue);
        Point point = default;
        point.X = 7;
        Point? optional = point;
        point.X = 18;
        optional = (Point?)(object)optional;
        Console.WriteLine(optional.Value.X);
        optional = default;
        Console.WriteLine(optional.GetValueOrDefault().X);
        decimal? amount = new decimal?(new decimal(42));
        Console.WriteLine(amount.Value);
        Counter counter = default;
        counter.Value = 4;
        Counter? mutable = counter;
        Console.WriteLine(mutable.ToString());
        Console.WriteLine(mutable.Value.Value);
        Console.WriteLine(Read(in mutable));
        Console.WriteLine(mutable.Value.Value);
        Console.WriteLine(((Counter?)counter).ToString());
        Console.WriteLine(counter.Value);
        Counter? absent = null;
        Console.WriteLine(absent.ToString());
        bool? yes = true, no = false;
        char? letter = 'A';
        uint? unsigned = uint.MaxValue;
        ulong? wide = ulong.MaxValue;
        Console.WriteLine(yes.ToString());
        Console.WriteLine(no.ToString());
        Console.WriteLine(letter.ToString());
        Console.WriteLine(unsigned.ToString());
        Console.WriteLine(wide.ToString());
    }
}
