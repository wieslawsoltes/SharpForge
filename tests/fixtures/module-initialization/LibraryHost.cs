using System;

// Compile Library.cs as a library, then reference that assembly from this host.
class Program
{
    static void Main()
    {
        Console.WriteLine(Export.Read());
        Console.WriteLine(Export.Read());
    }
}
