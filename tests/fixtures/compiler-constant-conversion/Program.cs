using System;
class Program {
    static int Convert(double value) { return unchecked((int)value); }
    static void Main() {
        const int positive = unchecked((int)2147483648.0);
        const int negative = unchecked((int)-2147483649.0);
        const int nan = unchecked((int)(0.0 / 0.0));
        const int infinity = unchecked((int)(1.0 / 0.0));
        const int negativeInfinity = unchecked((int)(-1.0 / 0.0));
        Console.WriteLine(positive);
        Console.WriteLine(negative);
        Console.WriteLine(nan);
        Console.WriteLine(infinity);
        Console.WriteLine(negativeInfinity);
        Console.WriteLine(Convert(2147483648.0));
        Console.WriteLine(Convert(-2147483649.0));
        Console.WriteLine(Convert(0.0 / 0.0));
        Console.WriteLine(Convert(1.0 / 0.0));
        Console.WriteLine(Convert(-1.0 / 0.0));
        Console.WriteLine(unchecked((int)2147483647.9));
        Console.WriteLine(unchecked((int)-2147483648.9));
        Console.WriteLine(unchecked((int)-1.9));
        Console.WriteLine(Convert(2147483647.9));
        Console.WriteLine(Convert(-2147483648.9));
        Console.WriteLine(Convert(-1.9));
    }
}
