using System;

// Reduced from stress-spans/ring-buffer-text-builder: `readonly ref int` fixes the reference of a ref field, not the
// variable it refers to - assignments, compound assignments and `++` through it are allowed, also in readonly members.
public ref struct Counter
{
    private readonly ref int _total;
    private readonly Span<int> _slots;
    private int _next;

    public Counter(Span<int> slots, ref int total)
    {
        _slots = slots;
        _total = ref total;
        _next = 0;
    }

    public void Push(int value)
    {
        _slots[_next++ % _slots.Length] = value;
        _total++;
        _total += value;
    }

    public readonly void Reset() => _total = 0;

    public readonly int Total => _total;
}

public static class Program
{
    public static void Main()
    {
        int total = 100;
        Span<int> slots = stackalloc int[2];
        var counter = new Counter(slots, ref total);
        counter.Push(5);
        counter.Push(7);
        counter.Push(9);
        Console.WriteLine(total + " " + counter.Total + " " + slots[0] + "," + slots[1]);
        counter.Reset();
        Console.WriteLine(total + " " + counter.Total);
    }
}
