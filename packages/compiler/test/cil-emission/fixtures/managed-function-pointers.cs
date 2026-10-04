using System;

unsafe class Program
{
    static int Add(int first, int second) => first + second;
    static int Invoke(delegate*<int, int, int> pointer, int first, int second) => pointer(first, second);

    static void Main()
    {
        delegate*<int, int, int> pointer = &Add;
        Console.WriteLine(pointer(19, 23));
        Console.WriteLine(Invoke(pointer, 3, 5));
        Console.WriteLine(Invoke(&Add, 7, 11));
    }
}
