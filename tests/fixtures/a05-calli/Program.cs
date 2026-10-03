using System;
unsafe class Program {
    static delegate* managed<int, int> Target;
    static int Increment(int value) { return value + 1; }
    static delegate* managed<int, int> Create() { return &Increment; }
    static int Apply(delegate* managed<int, int> function, int value) { return function(value); }
    static void Main() {
        delegate* managed<int, int> function = &Increment;
        Console.WriteLine(function(41));
        Console.WriteLine(Apply(function, 6));
        Target = function;
        Console.WriteLine(Target(9));
        delegate* managed<delegate* managed<int, int>> factory = &Create;
        function = factory();
        Console.WriteLine(function(8));
    }
}
