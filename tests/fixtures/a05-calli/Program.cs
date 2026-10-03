using System;
unsafe class Program {
    static int Increment(int value) { return value + 1; }
    static int Apply(delegate* managed<int, int> function, int value) { return function(value); }
    static void Main() {
        delegate* managed<int, int> function = &Increment;
        Console.WriteLine(function(41));
        Console.WriteLine(Apply(function, 6));
    }
}
