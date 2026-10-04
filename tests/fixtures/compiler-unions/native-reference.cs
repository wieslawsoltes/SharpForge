using System;
#nullable enable

// Explicit implementation of the pinned lowering, since the pinned Roslyn does not parse union declarations.
[System.Runtime.CompilerServices.Union]
struct NumberOrText : System.Runtime.CompilerServices.IUnion
{
    public NumberOrText(int value) { Value = value; }
    public NumberOrText(string value) { Value = value; }
    public object? Value { get; }
}

[System.Runtime.CompilerServices.Union]
struct Generic<T> : System.Runtime.CompilerServices.IUnion
{
    public Generic(T value) { Value = value; }
    public Generic(bool value) { Value = value; }
    public object? Value { get; }
}

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

#nullable disable
class Program
{
    static void Main()
    {
        NumberOrText original = new NumberOrText(42);
        NumberOrText copy = original;
        original = new NumberOrText("changed");
        Console.WriteLine(copy.Value is int number && number == 42);
        Console.WriteLine(original.Value is "changed");
        Console.WriteLine(default(NumberOrText).Value == null);
        Generic<int> generic = new Generic<int>(17);
        Console.WriteLine(generic.Value is int result && result == 17);
        NumberOrText? wrapped = new NumberOrText(7);
        NumberOrText? empty = new NumberOrText((string)null);
        NumberOrText? absent = null;
        Console.WriteLine(wrapped.HasValue && wrapped.GetValueOrDefault().Value is int present && present == 7);
        Console.WriteLine(!empty.HasValue || empty.GetValueOrDefault().Value is null);
        Console.WriteLine(!absent.HasValue || absent.GetValueOrDefault().Value is null);
        Provided provider = Provided.IUnionMembers.Create(9);
        Console.WriteLine(((Provided.IUnionMembers)provider).Value is int item && item == 9);
        Console.WriteLine(((Provided.IUnionMembers)provider).Value is not null);
        Console.WriteLine(typeof(NumberOrText).IsValueType);
    }
}
