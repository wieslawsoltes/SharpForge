using System;
class Program {
    static int Sum(__arglist) {
        ArgIterator iterator = new ArgIterator(__arglist);
        int sum = 0;
        while (iterator.GetRemainingCount() > 0) {
            TypedReference next = iterator.GetNextArg();
            sum += __refvalue(next, int);
        }
        iterator.End();
        return sum;
    }
    static int Optional(int value = 7) { return value; }
    static int Params(params int[] values) { return values[0] + values[1]; }
    static void Main() {
        Console.WriteLine(Sum(__arglist(4, 5, 6)));
        Console.WriteLine(Optional());
        Console.WriteLine(Params(20, 22));
    }
}
