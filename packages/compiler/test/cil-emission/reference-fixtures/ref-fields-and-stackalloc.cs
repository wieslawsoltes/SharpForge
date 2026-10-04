using System;

// `ref` fields of a ref struct, ref assignment to a field, ref conditional expressions, and `stackalloc` to spans -
// as a statement, with initializers, with a size computed at run time and as an operand of a larger expression.

ref struct Cursor
{
    public Span<int> Items;
    public ref int Current;
    public ref readonly int First;

    public Cursor(Span<int> items)
    {
        Items = items;
        Current = ref items[0];
        First = ref items[0];
    }

    public void MoveTo(int index) { Current = ref Items[index]; }
    public void Add(int amount) { Current += amount; }
    public ref int Slot() { return ref Current; }
}

static class Program
{
    static int Sum(ReadOnlySpan<int> values)
    {
        int sum = 0;
        foreach (var value in values) sum += value;
        return sum;
    }

    static ref int Larger(ref int left, ref int right) => ref (left > right ? ref left : ref right);

    static int Fill(int count)
    {
        Span<long> wide = stackalloc long[count];
        for (int index = 0; index < wide.Length; index++) wide[index] = index * 10L;
        return (int)wide[count - 1] + wide.Length;
    }

    static void RefFields()
    {
        int[] data = { 1, 2, 3, 4 };
        var cursor = new Cursor(data);
        cursor.Current = 10;
        cursor.MoveTo(2);
        cursor.Current++;
        cursor.Add(5);
        cursor.Slot() *= 2;
        ref int direct = ref cursor.Current;
        direct += 1;
        Console.WriteLine(string.Join(",", data) + " " + cursor.First + " " + cursor.Current);
    }

    static void RefConditionals()
    {
        int small = 1, large = 5;
        Larger(ref small, ref large) = 50;
        ref int chosen = ref (small > 0 ? ref small : ref large);
        chosen = 7;
        (small > large ? ref small : ref large) += 3;
        Console.WriteLine(small + " " + large + " " + (small < large ? ref small : ref large));
    }

    static void StackAllocations()
    {
        Span<int> zeroed = stackalloc int[3];
        zeroed[1] = 4;
        Span<int> listed = stackalloc[] { 4, 5, 6 };
        Span<byte> bytes = stackalloc byte[2] { 7, 8 };
        ReadOnlySpan<char> text = stackalloc char[] { 'o', 'k' };
        Console.WriteLine(zeroed[0] + zeroed[1] + " " + listed.Length + listed[2] + " " + bytes[1] + " " + text.ToString());
        Console.WriteLine("sum " + Sum(listed) + " " + Sum(stackalloc int[] { 1, 2, 3 }) + " " + Fill(4));
        int total = 0;
        for (int round = 1; round <= 3; round++) total += Sum(stackalloc int[] { round, round * 2 });
        Console.WriteLine(total);
    }

    static void Main()
    {
        RefFields();
        RefConditionals();
        StackAllocations();
    }
}
