using System;
using ExtensionImport;

class Program
{
    static void Main()
    {
        var box = Box.New(4);
        Console.WriteLine(box.Twice);
        box.Writable = 7;
        Console.WriteLine(box.Add());
        Console.WriteLine((box + new Box(2)).Value);
        var generic = Box<int>.Create(5);
        generic.Item = 9;
        Console.WriteLine(generic.Item);
        Console.WriteLine(Box<int>.Identity(6));
        Console.WriteLine(new[] { 3, 4 }.First);
        Console.WriteLine(Box<int>.IsUnmanaged);
        Console.WriteLine(Box<string>.Create("ok").ReferenceValue);
        Console.WriteLine(Box.New("abc").Value);
        Console.WriteLine(generic.Map(value => value + 2));
        Console.WriteLine(generic.SameType(12));
        var counter = new Counter { Value = 3 };
        counter.Current = 14;
        Console.WriteLine(counter.Current);
    }
}
