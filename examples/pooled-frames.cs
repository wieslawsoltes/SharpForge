using System;
class Program
{
    static int Sum(int depth)
    {
        if (depth == 0) return 0;
        return depth + Sum(depth - 1);
    }
    static void Main()
    {
        for (int pass = 0; pass < 3; pass++) Console.WriteLine(Sum(80));
        GC.Collect();
    }
}
