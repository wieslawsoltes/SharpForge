using System;

union NumberOrText(int, string);
union Generic<T>(T, bool);

[System.Runtime.CompilerServices.Union]
struct Provided : Provided.IUnionMembers
{
    private object contents;
    private Provided(object value, bool marker) { contents = value; }
    public interface IUnionMembers
    {
        public static Provided Create(int value) => new Provided(value, true);
        object Value { get; }
    }
    object IUnionMembers.Value => contents;
}

class Program
{
    static void Main()
    {
        NumberOrText original = 42;
        NumberOrText copy = original;
        original = "changed";
        Console.WriteLine(copy is int number && number == 42);
        Console.WriteLine(original is "changed");
        Console.WriteLine(default(NumberOrText).Value == null);
        Generic<int> generic = 17;
        Console.WriteLine(generic is int result && result == 17);
        NumberOrText? wrapped = 7;
        NumberOrText? empty = (string)null;
        NumberOrText? absent = null;
        Console.WriteLine(wrapped is int present && present == 7);
        Console.WriteLine(empty is null);
        Console.WriteLine(absent is null);
        Provided provider = 9;
        Console.WriteLine(provider is int item && item == 9);
        Console.WriteLine(provider is not null);
        Console.WriteLine(typeof(NumberOrText).IsValueType);
    }
}
