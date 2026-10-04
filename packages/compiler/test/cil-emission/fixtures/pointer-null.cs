using System;

unsafe struct Node
{
    public Node* Next;
}

unsafe class Program
{
    static int Read(int* pointer) => pointer == null ? 17 : *pointer;
    static bool IsFunctionNull(delegate*<int> pointer) => pointer == null;

    static void Main()
    {
        int* pointer = null;
        void* raw = null;
        Node node = default;
        Console.WriteLine(pointer == null);
        Console.WriteLine(raw == null);
        Console.WriteLine(node.Next == null);
        Console.WriteLine(Read(null));
        delegate*<int*, int> read = &Read;
        Console.WriteLine(read(null));
        Console.WriteLine(IsFunctionNull(null));
        int value = 23;
        pointer = &value;
        Console.WriteLine(pointer != null);
        Console.WriteLine(Read(pointer));
        pointer = default;
        Console.WriteLine(Read(pointer));
    }
}
