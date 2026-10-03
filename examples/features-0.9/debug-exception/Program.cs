try
{
    int value = 2147483647;
    value = checked(value + 1);
}
catch (Exception error)
{
    Console.WriteLine("overflow caught");
}
finally
{
    Console.WriteLine("cleanup");
}
Console.WriteLine(42);
