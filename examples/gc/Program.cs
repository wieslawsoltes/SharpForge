using System;

class Node
{
    public Node Next;
    public int Value;
}

class Program
{
    static void Main()
    {
        var first = new Node();
        var second = new Node();
        first.Value = 10;
        second.Value = 20;
        first.Next = second;
        second.Next = first;

        Console.WriteLine("Before: " + GC.GetTotalMemory(false) + " bytes");
        first = null;
        second = null;

        // The cycle has no roots. The collector traces and reclaims it.
        GC.Collect();
        Console.WriteLine("Collections: " + GC.CollectionCount(0));
        Console.WriteLine("After: " + GC.GetTotalMemory(false) + " bytes");
    }
}
