using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

unsafe class Program
{
    static int cell;
    static delegate*<int, int, int> operation;

    static int Add(int left, int right) => left + right;
    static int Multiply(int left, int right) => left * right;
    static T Identity<T>(T value) => value;
    static string Text(object value) => value.ToString();
    static ref int Cell() => ref cell;
    static ref readonly int ReadCell() => ref cell;
    static void Update(ref int value, out int doubled, in int offset)
    {
        value += offset;
        doubled = value * 2;
    }

    static int Invoke(delegate*<int, int> transform, int value) => transform(value);
    static T Apply<T>(delegate*<T, T> transform, T value) => transform(value);
    static delegate*<int, int, int> Target()
    {
        Console.Write("target;");
        return operation;
    }
    static int Argument()
    {
        Console.Write("argument;");
        operation = &Multiply;
        return 3;
    }
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    static int Native(int value) => value + 100;

    static void Main()
    {
        delegate*<int, int> identity = &Identity<int>;
        delegate*<string, string> inferred = &Identity;
        Console.WriteLine(identity(7));
        Console.WriteLine(inferred("inferred"));
        Console.WriteLine(Invoke(&Identity, 9));
        Console.WriteLine(Apply(identity, 11));
        delegate*<int, int, int>[] table = { &Add, &Multiply, &Math.Max };
        Console.WriteLine(table[0](3, 4) + table[1](3, 4) + table[2](3, 4));
        operation = &Add;
        Console.WriteLine(Target()(Argument(), 7));
        Console.WriteLine(operation(3, 7));
        delegate*<object, string> original = &Text;
        delegate*<string, object> variant = original;
        Console.WriteLine(variant("variance"));
        delegate*<ref int, out int, in int, void> update = &Update;
        int value = 5, offset = 4;
        update(ref value, out int doubled, in offset);
        Console.WriteLine(value + doubled);
        delegate*<ref int> getCell = &Cell;
        ref int alias = ref getCell();
        alias = 17;
        getCell() += 3;
        delegate*<ref readonly int> readCell = &ReadCell;
        Console.WriteLine(readCell());
        delegate* unmanaged[Cdecl]<int, int> native = &Native;
        Console.WriteLine(native(23));
        delegate*<int> empty = null;
        Console.WriteLine(empty == null);
        Console.WriteLine(sizeof(delegate*<int>) == sizeof(void*));
    }
}
