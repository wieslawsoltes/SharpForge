using System;

class MathError : Exception
{
    public int Code;

    public MathError(string message, int code) : base(message)
    {
        Code = code;
    }
}

class Program
{
    static void Main()
    {
        try
        {
            throw new MathError("custom", 42);
        }
        catch (MathError error)
        {
            Console.WriteLine(error.Message + " " + error.Code);
        }
        try
        {
            throw new InvalidOperationException("framework exception");
        }
        catch (ArgumentException)
        {
            Console.WriteLine("wrong handler");
        }
        catch (InvalidOperationException error)
        {
            Console.WriteLine(error.Message);
        }
    }
}
