using System;

class Program
{
    static int Total(int first, __arglist)
    {
        ArgIterator iterator = new ArgIterator(__arglist);
        int total = first;
        while (iterator.GetRemainingCount() > 0)
        {
            TypedReference next = iterator.GetNextArg();
            total += __refvalue(next, int);
        }
        iterator.End();
        return total;
    }

    static void Mixed(__arglist)
    {
        ArgIterator iterator = new ArgIterator(__arglist);
        TypedReference first = iterator.GetNextArg();
        Console.WriteLine(__refvalue(first, string));
        TypedReference second = iterator.GetNextArg();
        __refvalue(second, int) = 19;
        Console.WriteLine(__refvalue(second, int));
        Console.WriteLine(iterator.GetRemainingCount());
    }

    static void Main()
    {
        Console.WriteLine(Total(1, __arglist(2, 3)));
        Console.WriteLine(Total(7, __arglist()));
        int number = 4;
        Mixed(__arglist("mixed", number));
        Console.WriteLine(number);
        TypedReference reference = __makeref(number);
        __refvalue(reference, int) = 9;
        Console.WriteLine(number);
        Console.WriteLine(__reftype(reference).Name);
        Console.WriteLine(TypedReference.ToObject(reference));
        try { Console.WriteLine(__refvalue(reference, long)); }
        catch (InvalidCastException) { Console.WriteLine("type mismatch"); }
        int[] values = new int[1];
        TypedReference element = __makeref(values[0]);
        __refvalue(element, int) = 23;
        Console.WriteLine(values[0]);
    }
}
