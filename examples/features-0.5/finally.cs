int Work()
{
    try { return 42; }
    finally { Console.WriteLine("cleanup"); }
}
Console.WriteLine(Work());
try
{
    try { throw new Exception("failure"); }
    finally { Console.WriteLine("inner cleanup"); }
}
catch (Exception error) { Console.WriteLine(error.Message); }
finally { Console.WriteLine("outer cleanup"); }
